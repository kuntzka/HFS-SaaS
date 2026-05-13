using HFS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize]
public class ReferenceDataController(ReferenceDataRepository repo) : ControllerBase
{
    [HttpGet("routes")]
    public async Task<IActionResult> GetRoutes() =>
        Ok(await repo.GetRoutesAsync());

    [HttpPut("routes/{id:int}")]
    public async Task<IActionResult> UpdateRoute(int id, [FromBody] UpdateRouteRequest req)
    {
        var ok = await repo.UpdateRouteAsync(id, req.EmployeeId);
        return ok ? NoContent() : NotFound();
    }

    [HttpGet("service-types")]
    public async Task<IActionResult> GetServiceTypes() =>
        Ok(await repo.GetServiceTypesAsync());

    [HttpGet("frequency-codes")]
    public async Task<IActionResult> GetFrequencyCodes() =>
        Ok(await repo.GetFrequencyCodesAsync());

    [HttpGet("pay-types")]
    public async Task<IActionResult> GetPayTypes() =>
        Ok(await repo.GetPayTypesAsync());

    [HttpGet("tax-rates")]
    public async Task<IActionResult> GetTaxRates() =>
        Ok(await repo.GetSalesTaxesAsync());

    [HttpGet("offset-codes")]
    public async Task<IActionResult> GetOffsetCodes() =>
        Ok(await repo.GetOffsetCodesAsync());
}

public record UpdateRouteRequest(int? EmployeeId);
