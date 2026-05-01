using HFS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

public record CreateEmployeeRequest(string FirstName, string LastName, DateOnly FirstPeriodStart);
public record UpdateEmployeeNameRequest(string FirstName, string LastName);
public record UpsertPeriodRequest(DateOnly StartDate, DateOnly? EndDate);

[ApiController]
[Route("api/employees")]
[Authorize]
public class EmployeesController(EmployeeRepository repo) : ControllerBase
{
    private readonly EmployeeRepository _repo = repo;

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await _repo.GetAllAsync());

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var employee = await _repo.GetByIdAsync(id);
        return employee is null ? NotFound() : Ok(employee);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeRequest request)
    {
        var employeeId = await _repo.CreateAsync(request.FirstName, request.LastName, request.FirstPeriodStart);
        return CreatedAtAction(nameof(GetById), new { id = employeeId }, new { employeeId });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateName(int id, [FromBody] UpdateEmployeeNameRequest request)
    {
        await _repo.UpdateNameAsync(id, request.FirstName, request.LastName);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (await _repo.IsInUseAsync(id))
            return Conflict(new { message = "Employee has commission or customer records and cannot be deleted. Use Deactivate instead." });
        await _repo.DeleteAsync(id);
        return NoContent();
    }

    [HttpPost("{id:int}/deactivate")]
    public async Task<IActionResult> Deactivate(int id)
    {
        await _repo.DeactivateAsync(id);
        return NoContent();
    }

    [HttpGet("{id:int}/periods")]
    public async Task<IActionResult> GetPeriods(int id) =>
        Ok(await _repo.GetPeriodsAsync(id));

    [HttpPost("{id:int}/periods")]
    public async Task<IActionResult> AddPeriod(int id, [FromBody] UpsertPeriodRequest request)
    {
        if (await _repo.HasOverlapAsync(id, request.StartDate, request.EndDate, excludePeriodId: null))
            return BadRequest(new { message = "This period overlaps with an existing period for this employee." });
        var periodId = await _repo.AddPeriodAsync(id, request.StartDate, request.EndDate);
        return StatusCode(201, new { id = periodId });
    }

    [HttpPut("{id:int}/periods/{periodId:int}")]
    public async Task<IActionResult> UpdatePeriod(int id, int periodId, [FromBody] UpsertPeriodRequest request)
    {
        if (await _repo.HasOverlapAsync(id, request.StartDate, request.EndDate, excludePeriodId: periodId))
            return BadRequest(new { message = "This period overlaps with an existing period for this employee." });
        var ok = await _repo.UpdatePeriodAsync(id, periodId, request.StartDate, request.EndDate);
        return ok ? NoContent() : NotFound();
    }

    [HttpDelete("{id:int}/periods/{periodId:int}")]
    public async Task<IActionResult> DeletePeriod(int id, int periodId)
    {
        var ok = await _repo.DeletePeriodAsync(id, periodId);
        return ok ? NoContent() : NotFound();
    }
}
