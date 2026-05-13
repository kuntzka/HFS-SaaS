using HFS.Application.Commissions;
using HFS.Infrastructure.Data;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

[ApiController]
[Route("api/commissions")]
[Authorize]
public class CommissionsController(IMediator mediator, CommissionRepository commissionRepo) : ControllerBase
{
    [HttpPost("preview")]
    public async Task<IActionResult> Preview([FromBody] PreviewCommissionRequest req, CancellationToken ct)
    {
        var result = await mediator.Send(
            new PreviewCommissionCommand(
                req.InvoiceNumber,
                req.ServiceDate,
                req.SacEmployeeId,
                req.CalculateAmc,
                req.AmcEmployeeId,
                req.Overrides), ct);
        return Ok(result);
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveCommissionsRequest req, CancellationToken ct)
    {
        var count = await mediator.Send(
            new SaveCommissionsCommand(req.InvoiceNumber, req.ServiceDate, req.Items), ct);
        return Ok(new { saved = count });
    }

    [HttpGet("invoice/{invoiceNumber:int}")]
    public async Task<IActionResult> GetByInvoice(int invoiceNumber)
    {
        var items = await commissionRepo.GetByInvoiceAsync(invoiceNumber);
        return Ok(items);
    }

    [HttpGet]
    public async Task<IActionResult> GetByDateRange(
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] int? payrollType)
    {
        var items = await commissionRepo.GetByDateRangeAsync(from, to, payrollType);
        return Ok(items);
    }

    [HttpDelete("invoice/{invoiceNumber:int}")]
    public async Task<IActionResult> DeleteByInvoice(int invoiceNumber)
    {
        await commissionRepo.DeleteByInvoiceAsync(invoiceNumber);
        return NoContent();
    }
}

public record PreviewCommissionRequest(
    int InvoiceNumber,
    DateOnly ServiceDate,
    int? SacEmployeeId,
    bool CalculateAmc,
    int? AmcEmployeeId,
    IReadOnlyList<ServicePriceOverride>? Overrides);

public record SaveCommissionsRequest(
    int InvoiceNumber,
    DateOnly ServiceDate,
    IReadOnlyList<SaveCommissionItem> Items);
