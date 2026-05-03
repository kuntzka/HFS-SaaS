using System.Text.Json;
using HFS.Application.Invoices;
using HFS.Infrastructure.Data;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

[ApiController]
[Route("api/invoices")]
[Authorize]
public class InvoicesController(IMediator mediator, InvoiceRepository invoiceRepo) : ControllerBase
{
    private static readonly JsonSerializerOptions _camelCase = new(JsonSerializerDefaults.Web);

    [HttpPost("generate")]
    public async Task Generate([FromBody] GenerateInvoicesRequest req, CancellationToken ct)
    {
        Response.Headers["Content-Type"] = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";

        async Task Send(object payload)
        {
            await Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, _camelCase)}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }

        var progress = new Progress<InvoiceProgressUpdate>(async update =>
            await Send(new { type = "progress", update.CustomerId, update.InvoicesCreated }));

        try
        {
            var result = await mediator.Send(
                new GenerateInvoicesCommand(req.Week, req.Year, req.Force, progress), ct);
            await Send(new { type = "done", result.InvoicesCreated, result.ServicesProcessed });
        }
        catch (InvalidOperationException ex)
        {
            await Send(new { type = "alreadyExists", message = ex.Message });
        }
        catch (Exception ex)
        {
            await Send(new { type = "error", message = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetByWeekYear([FromQuery] short week, [FromQuery] short year)
    {
        var items = await invoiceRepo.GetByWeekYearAsync(week, year);
        return Ok(items);
    }

    [HttpGet("{invoiceNumber:int}/detail")]
    public async Task<IActionResult> GetDetail(int invoiceNumber)
    {
        var rows = await invoiceRepo.GetDetailAsync(invoiceNumber);
        return Ok(rows);
    }

    [HttpPut("{invoiceNumber:int}/complete")]
    public async Task<IActionResult> SetComplete(int invoiceNumber, [FromBody] SetCompleteRequest req)
    {
        var ok = await invoiceRepo.SetCompleteAsync(invoiceNumber, req.Complete);
        return ok ? NoContent() : NotFound();
    }

    [HttpPut("{invoiceNumber:int}/printed")]
    public async Task<IActionResult> SetPrinted(int invoiceNumber)
    {
        var ok = await invoiceRepo.SetPrintedAsync(invoiceNumber);
        return ok ? NoContent() : NotFound();
    }

    [HttpPut("{invoiceNumber:int}/service-date")]
    public async Task<IActionResult> SetServiceDate(int invoiceNumber, [FromBody] SetServiceDateRequest req)
    {
        var ok = await invoiceRepo.UpdateServiceDateAsync(invoiceNumber, req.ServiceDate);
        return ok ? NoContent() : NotFound();
    }

    [HttpGet("{invoiceNumber:int}/svc-lines")]
    public async Task<IActionResult> GetSvcLines(int invoiceNumber)
    {
        var lines = await invoiceRepo.GetEditableSvcLinesAsync(invoiceNumber);
        return Ok(lines);
    }

    [HttpPut("{invoiceNumber:int}/svc-lines")]
    public async Task<IActionResult> UpdateSvcLines(int invoiceNumber, [FromBody] List<SvcLineUpdate> updates)
    {
        await invoiceRepo.UpdateSvcLinesAsync(invoiceNumber, updates.Select(u => (u.Id, u.ServicePrice, u.Tax)));
        return NoContent();
    }

    [HttpPost("{invoiceNumber:int}/svc-lines")]
    public async Task<IActionResult> AddSvcLine(
        int invoiceNumber, [FromBody] AddSvcLineRequest req)
    {
        var newId = await invoiceRepo.AddSvcLineAsync(
            invoiceNumber, req.ServiceDesc, req.ServiceQty,
            req.ServicePrice, req.Tax, req.Comments);
        return Created($"/api/invoices/{invoiceNumber}/svc-lines/{newId}", new { id = newId });
    }

    [HttpDelete("{invoiceNumber:int}/svc-lines/{lineId:int}")]
    public async Task<IActionResult> DeleteSvcLine(int invoiceNumber, int lineId)
    {
        var ok = await invoiceRepo.DeleteSvcLineAsync(lineId, invoiceNumber);
        return ok ? NoContent() : NotFound();
    }
}

public record GenerateInvoicesRequest(short Week, short Year, bool Force = false);
public record SetCompleteRequest(bool Complete);
public record SetServiceDateRequest(DateOnly? ServiceDate);
public record SvcLineUpdate(int Id, decimal ServicePrice, decimal Tax);
public record AddSvcLineRequest(
    string ServiceDesc,
    int ServiceQty,
    decimal ServicePrice,
    decimal Tax,
    string? Comments);
