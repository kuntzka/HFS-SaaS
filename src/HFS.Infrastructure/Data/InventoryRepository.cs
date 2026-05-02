using Dapper;

namespace HFS.Infrastructure.Data;

public record InventoryItem(
    string Sku,
    string Description,
    int QtyOnHand,
    int MinLevel,
    bool BelowMinimum);

public record CustomerSvcInventoryItem(
    int Id,
    string Sku,
    string Description,
    int Quantity,
    short GroupNumber,
    int ItemNumber,
    string? Comments);

public class InventoryRepository(SqlConnectionFactory db)
{
    public async Task<IEnumerable<InventoryItem>> GetAllAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<InventoryItem>(db.Sql("""
            SELECT sku AS Sku, description AS Description,
                   qty_on_hand AS QtyOnHand, min_level AS MinLevel,
                   CAST(CASE WHEN qty_on_hand <= min_level THEN 1 ELSE 0 END AS BIT) AS BelowMinimum
            FROM {schema}.inventory_master
            ORDER BY sku
            """));
    }

    public async Task<IEnumerable<InventoryItem>> GetBelowMinimumAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<InventoryItem>(db.Sql("""
            SELECT sku AS Sku, description AS Description,
                   qty_on_hand AS QtyOnHand, min_level AS MinLevel,
                   CAST(1 AS BIT) AS BelowMinimum
            FROM {schema}.inventory_master
            WHERE qty_on_hand <= min_level
            ORDER BY sku
            """));
    }

    public async Task<InventoryItem?> GetBySkuAsync(string sku)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<InventoryItem>(db.Sql("""
            SELECT sku AS Sku, description AS Description,
                   qty_on_hand AS QtyOnHand, min_level AS MinLevel,
                   CAST(CASE WHEN qty_on_hand <= min_level THEN 1 ELSE 0 END AS BIT) AS BelowMinimum
            FROM {schema}.inventory_master WHERE sku = @sku
            """), new { sku });
    }

    public async Task<bool> ExistsAsync(string sku)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("SELECT COUNT(1) FROM {schema}.inventory_master WHERE sku = @sku"),
            new { sku }) > 0;
    }

    public async Task InsertAsync(string sku, string description, int qtyOnHand, int minLevel)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.inventory_master (sku, description, qty_on_hand, min_level)
            VALUES (@sku, @description, @qtyOnHand, @minLevel)
            """), new { sku, description, qtyOnHand, minLevel });
    }

    public async Task<bool> UpdateAsync(string sku, string description, int qtyOnHand, int minLevel)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.inventory_master
            SET description = @description, qty_on_hand = @qtyOnHand, min_level = @minLevel
            WHERE sku = @sku
            """), new { sku, description, qtyOnHand, minLevel });
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(string sku)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("DELETE FROM {schema}.inventory_master WHERE sku = @sku"),
            new { sku });
        return rows > 0;
    }

    public async Task<bool> IsSkuInUseAsync(string sku)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("SELECT COUNT(1) FROM {schema}.customer_service_inventory WHERE sku = @sku"),
            new { sku }) > 0;
    }

    // Port of clsInventory.mergeInventory: remap all customer_service_inventory rows, then delete old SKU
    public async Task<int> MergeAsync(string oldSku, string newSku)
    {
        using var conn = db.CreateConnection();
        var updated = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.customer_service_inventory SET sku = @newSku WHERE sku = @oldSku
            """), new { oldSku, newSku });
        await conn.ExecuteAsync(
            db.Sql("DELETE FROM {schema}.inventory_master WHERE sku = @oldSku"),
            new { oldSku });
        return updated;
    }

    public async Task<IEnumerable<CustomerSvcInventoryItem>> GetBySvcIdAsync(int customerSvcId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CustomerSvcInventoryItem>(db.Sql("""
            SELECT csi.id AS Id, csi.sku AS Sku, im.description AS Description,
                   csi.quantity AS Quantity, csi.group_number AS GroupNumber,
                   csi.item_number AS ItemNumber, csi.comments AS Comments
            FROM {schema}.customer_service_inventory csi
            JOIN {schema}.inventory_master im ON csi.sku = im.sku
            WHERE csi.customer_svc_id = @customerSvcId
            ORDER BY csi.group_number, csi.item_number, csi.sku
            """), new { customerSvcId });
    }

    public async Task<int> AddToServiceAsync(
        int customerSvcId, string sku, int quantity,
        short groupNumber, int itemNumber, string? comments)
    {
        using var conn = db.CreateConnection();
        var newId = await conn.QuerySingleAsync<int>(db.Sql("""
            INSERT INTO {schema}.customer_service_inventory
                (customer_svc_id, sku, quantity, group_number, item_number, comments)
            OUTPUT INSERTED.id
            VALUES
                (@customerSvcId, @sku, @quantity, @groupNumber, @itemNumber, @comments)
            """), new { customerSvcId, sku, quantity, groupNumber, itemNumber, comments });
        await RecalcServiceQtyAsync(conn, customerSvcId);
        return newId;
    }

    public async Task<bool> UpdateServiceItemAsync(
        int id, int customerSvcId, int quantity, short groupNumber, int itemNumber, string? comments)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.customer_service_inventory
            SET quantity     = @quantity,
                group_number = @groupNumber,
                item_number  = @itemNumber,
                comments     = @comments
            WHERE id = @id
            """), new { id, quantity, groupNumber, itemNumber, comments });
        if (rows > 0) await RecalcServiceQtyAsync(conn, customerSvcId);
        return rows > 0;
    }

    public async Task<bool> DeleteServiceItemAsync(int id, int customerSvcId)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("DELETE FROM {schema}.customer_service_inventory WHERE id = @id"),
            new { id });
        if (rows > 0) await RecalcServiceQtyAsync(conn, customerSvcId);
        return rows > 0;
    }

    private async Task RecalcServiceQtyAsync(System.Data.IDbConnection conn, int customerSvcId)
    {
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.customer_service
            SET service_qty = (
                SELECT ISNULL(SUM(quantity), 0)
                FROM {schema}.customer_service_inventory
                WHERE customer_svc_id = @customerSvcId
            )
            WHERE customer_svc_id = @customerSvcId
            """), new { customerSvcId });
    }

    public async Task<int> GetBelowMinimumCountAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(db.Sql(
            "SELECT COUNT(1) FROM {schema}.inventory_master WHERE qty_on_hand <= min_level"));
    }
}
