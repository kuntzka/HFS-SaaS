using HFS.Application.Commissions;
using HFS.Domain.Services;
using HFS.Infrastructure.Data;
using MediatR;

namespace HFS.Infrastructure.Commissions;

public class PreviewCommissionHandler(CommissionRepository commissionRepo)
    : IRequestHandler<PreviewCommissionCommand, IReadOnlyList<CommissionPreviewItem>>
{
    public async Task<IReadOnlyList<CommissionPreviewItem>> Handle(
        PreviewCommissionCommand cmd, CancellationToken ct)
    {
        var customerId = await commissionRepo.GetCustomerIdByInvoiceAsync(cmd.InvoiceNumber);
        var services = (await commissionRepo.GetServicesForCommissionAsync(customerId)).ToList();
        var serviceDate = cmd.ServiceDate.ToDateTime(TimeOnly.MinValue);
        var results = new List<CommissionPreviewItem>();

        // Build price override lookup: customerSvcId → overridden ServicePrice
        var overrideMap = (cmd.Overrides ?? [])
            .ToDictionary(o => o.CustomerSvcId, o => o.ServicePrice);

        // SAC: service agent commission — employee selected by user
        if (cmd.SacEmployeeId.HasValue)
        {
            int seniority = await commissionRepo.GetEmployeeExperienceAsync(cmd.SacEmployeeId.Value, serviceDate);
            string sacName = await commissionRepo.GetEmployeeNameAsync(cmd.SacEmployeeId.Value);

            foreach (var svc in services)
            {
                ct.ThrowIfCancellationRequested();
                var numWeek = CommissionCalculator.GetNumServiceWeek(serviceDate, svc.FirstServiceDate);
                var effectivePrice = overrideMap.TryGetValue(svc.CustomerSvcId, out var ov) ? ov : svc.ServicePrice;

                var (amount, payrollType, ruleDesc) = await CalculateSacAsync(
                    svc.ServiceTypeId, svc.CustomerType, svc.Distance,
                    numWeek, seniority, effectivePrice);

                results.Add(new CommissionPreviewItem(
                    CustomerSvcId: svc.CustomerSvcId,
                    CustomerId: svc.CustomerId,
                    CompanyName: svc.CompanyName,
                    ServiceTypeName: svc.ServiceTypeName,
                    ServicePrice: effectivePrice,
                    FrequencyCode: svc.FrequencyCode,
                    StartWeek: svc.StartWeek,
                    NumServiceWeek: numWeek,
                    CommissionType: "SAC",
                    EmployeeId: cmd.SacEmployeeId,
                    EmployeeName: sacName,
                    CommissionAmount: Math.Round(amount, 2),
                    PayrollType: payrollType,
                    RuleDescription: ruleDesc,
                    IsFirstCommission: false
                ));
            }
        }

        // AMC: account manager commission
        // AmcEmployeeId overrides per-service customer employee when provided
        if (cmd.CalculateAmc)
        {
            var excludedIds = await commissionRepo.GetExcludedEmployeeIdsAsync();
            // Hoist name lookup — same employee for all services when override is set
            string? amcOverrideName = cmd.AmcEmployeeId.HasValue
                ? await commissionRepo.GetEmployeeNameAsync(cmd.AmcEmployeeId.Value)
                : null;

            foreach (var svc in services)
            {
                ct.ThrowIfCancellationRequested();
                if (!svc.YnCommission) continue;

                // Use explicit override employee if provided, else fall back to service's customer employee
                int? resolvedEmployeeId = cmd.AmcEmployeeId ?? svc.EmployeeId;
                if (!resolvedEmployeeId.HasValue || excludedIds.Contains(resolvedEmployeeId.Value)) continue;

                var numWeek = CommissionCalculator.GetNumServiceWeek(serviceDate, svc.FirstServiceDate);
                int empId = resolvedEmployeeId.Value;
                string employeeName = amcOverrideName ?? svc.EmployeeName;

                var effectivePrice = overrideMap.TryGetValue(svc.CustomerSvcId, out var ov) ? ov : svc.ServicePrice;

                var (amount, payrollType, ruleDesc) = await CalculateAmcAsync(
                    empId, numWeek, svc.ServiceTypeId, effectivePrice);

                // Quarterly first-commission: if rate > 30% and already paid, zero out
                bool isFirst = false;
                if ((svc.FrequencyCode == "Q" || svc.FrequencyCode == "W12") && amount > 0)
                {
                    decimal rate = effectivePrice > 0 ? amount / effectivePrice : 0;
                    if (rate > 0.3m)
                    {
                        if (svc.CommissionPaid)
                            amount = 0;
                        else
                            isFirst = true;
                    }
                }

                results.Add(new CommissionPreviewItem(
                    CustomerSvcId: svc.CustomerSvcId,
                    CustomerId: svc.CustomerId,
                    CompanyName: svc.CompanyName,
                    ServiceTypeName: svc.ServiceTypeName,
                    ServicePrice: effectivePrice,
                    FrequencyCode: svc.FrequencyCode,
                    StartWeek: svc.StartWeek,
                    NumServiceWeek: numWeek,
                    CommissionType: "AMC",
                    EmployeeId: resolvedEmployeeId,
                    EmployeeName: employeeName,
                    CommissionAmount: Math.Round(amount, 2),
                    PayrollType: payrollType,
                    RuleDescription: ruleDesc,
                    IsFirstCommission: isFirst
                ));
            }
        }

        return results;
    }

    private async Task<(decimal Amount, int PayrollType, string RuleDesc)> CalculateSacAsync(
        int serviceTypeId, int siteType, int distance, int weekId, int seniority, decimal price)
    {
        // Tier 1: item rule (site type = customer type)
        var item = await commissionRepo.GetServiceItemRuleAsync(serviceTypeId, siteType);
        if (item is not null)
            return (1 * item.Rate, 4, $"Item Rule: {item.Id}");

        // Tier 2: calc rule (distance + seniority)
        var calc = await commissionRepo.GetServiceCalcRuleAsync(serviceTypeId, distance, seniority);
        if (calc is not null)
            return (price * calc.Percent, 4, $"Calc Rule: {calc.Id}");

        // Tier 3: week rule
        var week = await commissionRepo.GetServiceWeekRuleAsync(serviceTypeId, weekId);
        if (week is not null)
            return (price * week.Percent, 4, $"Week Rule: {week.Id}");

        return (0, 4, "No rule matched");
    }

    private async Task<(decimal Amount, int PayrollType, string RuleDesc)> CalculateAmcAsync(
        int employeeId, int weekId, int serviceTypeId, decimal price)
    {
        // 4-level specificity fallback (port of clsAccountManagerCommission.getAMC)
        var r = await commissionRepo.GetAccountMgrRuleAsync(employeeId, weekId, serviceTypeId);
        r ??= await commissionRepo.GetAccountMgrRuleAsync(employeeId, 0, serviceTypeId);
        r ??= await commissionRepo.GetAccountMgrRuleAsync(0, weekId, serviceTypeId);
        r ??= await commissionRepo.GetAccountMgrRuleAsync(0, weekId, 0);

        if (r is null) return (0, 4, "No rule matched");
        return (price * r.Percent, r.PayrollFlag, $"AMC Rule: {r.Id}");
    }
}
