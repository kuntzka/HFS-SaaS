using HFS.Domain.Entities;
using HFS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

[ApiController]
[Route("api/customers")]
[Authorize]
public class CustomersController(CustomerRepository repo, InventoryRepository inventoryRepo) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? search, [FromQuery] bool includeInactive = false) =>
        Ok(await repo.SearchAsync(search, includeInactive));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var customer = await repo.GetByIdAsync(id);
        return customer is null ? NotFound() : Ok(customer);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UpsertCustomerRequest req)
    {
        var entity = req.ToEntity();
        var newId = await repo.CreateAsync(entity);
        return CreatedAtAction(nameof(Get), new { id = newId }, new { customerId = newId });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpsertCustomerRequest req)
    {
        var entity = req.ToEntity();
        entity.CustomerId = id;
        return await repo.UpdateAsync(entity) ? NoContent() : NotFound();
    }

    // --- Services sub-resource ---

    [HttpGet("{id:int}/services")]
    public async Task<IActionResult> GetServices(int id)
    {
        var customer = await repo.GetByIdAsync(id);
        if (customer is null) return NotFound();
        return Ok(await repo.GetServicesAsync(id));
    }

    [HttpPost("{id:int}/services")]
    public async Task<IActionResult> CreateService(int id, [FromBody] UpsertCustomerServiceRequest req)
    {
        var customer = await repo.GetByIdAsync(id);
        if (customer is null) return NotFound();

        var entity = req.ToEntity(id);
        var newId = await repo.CreateServiceAsync(entity);
        return Created($"/api/customers/{id}/services/{newId}", new { customerSvcId = newId });
    }

    [HttpPut("{id:int}/services/{svcId:int}")]
    public async Task<IActionResult> UpdateService(int id, int svcId, [FromBody] UpsertCustomerServiceRequest req)
    {
        var entity = req.ToEntity(id);
        entity.CustomerSvcId = svcId;
        return await repo.UpdateServiceAsync(entity) ? NoContent() : NotFound();
    }

    [HttpDelete("{id:int}/services/{svcId:int}")]
    public async Task<IActionResult> DeleteService(int id, int svcId) =>
        await repo.DeleteServiceAsync(id, svcId) ? NoContent() : NotFound();

    [HttpGet("{id:int}/services/{svcId:int}/inventory")]
    public async Task<IActionResult> GetServiceInventory(int id, int svcId) =>
        Ok(await inventoryRepo.GetBySvcIdAsync(svcId));

    [HttpPost("{id:int}/services/{svcId:int}/inventory")]
    public async Task<IActionResult> AddServiceInventory(
        int id, int svcId, [FromBody] AddServiceInventoryRequest req)
    {
        var newId = await inventoryRepo.AddToServiceAsync(
            svcId, req.Sku, req.Quantity, req.GroupNumber, req.ItemNumber, req.Comments);
        return Created(
            $"/api/customers/{id}/services/{svcId}/inventory/{newId}",
            new { inventoryItemId = newId });
    }

    [HttpPut("{id:int}/services/{svcId:int}/inventory/{invId:int}")]
    public async Task<IActionResult> UpdateServiceInventory(
        int id, int svcId, int invId, [FromBody] UpdateServiceInventoryRequest req)
    {
        var ok = await inventoryRepo.UpdateServiceItemAsync(
            invId, svcId, req.Quantity, req.GroupNumber, req.ItemNumber, req.Comments);
        return ok ? NoContent() : NotFound();
    }

    [HttpDelete("{id:int}/services/{svcId:int}/inventory/{invId:int}")]
    public async Task<IActionResult> DeleteServiceInventory(int id, int svcId, int invId)
    {
        var ok = await inventoryRepo.DeleteServiceItemAsync(invId, svcId);
        return ok ? NoContent() : NotFound();
    }
}

public record UpsertCustomerRequest(
    string CompanyName,
    string? Address1,
    string? Address2,
    string? City,
    string? StateCode,
    string? Zip,
    string? BillingAddress1,
    string? BillingAddress2,
    string? BillingCity,
    string? BillingStateCode,
    string? BillingZip,
    string? Phone,
    int? PayTypeId,
    int? RouteId,
    int? EmployeeId,
    int? OffsetCodeId,
    int ArOffset,
    int? Distance,
    int CustomerType,
    bool CallFirst,
    bool IsTest,
    bool IsConsolidatedBilling,
    bool IsActive)
{
    public Customer ToEntity() => new()
    {
        CompanyName = CompanyName,
        Address1 = Address1,
        Address2 = Address2,
        City = City,
        StateCode = StateCode,
        Zip = Zip,
        BillingAddress1 = BillingAddress1,
        BillingAddress2 = BillingAddress2,
        BillingCity = BillingCity,
        BillingStateCode = BillingStateCode,
        BillingZip = BillingZip,
        Phone = Phone,
        PayTypeId = PayTypeId,
        RouteId = RouteId,
        EmployeeId = EmployeeId,
        OffsetCodeId = OffsetCodeId,
        ArOffset = ArOffset,
        Distance = Distance,
        CustomerType = CustomerType,
        CallFirst = CallFirst,
        IsTest = IsTest,
        IsConsolidatedBilling = IsConsolidatedBilling,
        IsActive = IsActive,
    };
}

public record UpsertCustomerServiceRequest(
    int ServiceTypeId,
    string FrequencyCode,
    decimal ServicePrice,
    int ServiceQty,
    short StartWeek,
    DateOnly? FirstServiceDate,
    DateOnly? LastServiceDate,
    int? SalesTaxId,
    bool CommissionPaid,
    string? Comments,
    bool IsActive)
{
    public CustomerService ToEntity(int customerId) => new()
    {
        CustomerId = customerId,
        ServiceTypeId = ServiceTypeId,
        FrequencyCode = FrequencyCode,
        ServicePrice = ServicePrice,
        ServiceQty = ServiceQty,
        StartWeek = StartWeek,
        FirstServiceDate = FirstServiceDate,
        LastServiceDate = LastServiceDate,
        SalesTaxId = SalesTaxId,
        CommissionPaid = CommissionPaid,
        Comments = Comments,
        IsActive = IsActive,
    };
}

public record AddServiceInventoryRequest(
    string Sku,
    int Quantity,
    short GroupNumber,
    int ItemNumber,
    string? Comments);

public record UpdateServiceInventoryRequest(
    int Quantity,
    short GroupNumber,
    int ItemNumber,
    string? Comments);
