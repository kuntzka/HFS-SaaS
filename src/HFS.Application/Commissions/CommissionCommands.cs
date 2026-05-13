using MediatR;

namespace HFS.Application.Commissions;

public record ServicePriceOverride(int CustomerSvcId, decimal ServicePrice);

public record PreviewCommissionCommand(
    int InvoiceNumber,
    DateOnly ServiceDate,
    int? SacEmployeeId,
    bool CalculateAmc,
    int? AmcEmployeeId,
    IReadOnlyList<ServicePriceOverride>? Overrides
) : IRequest<IReadOnlyList<CommissionPreviewItem>>;

public record SaveCommissionsCommand(
    int InvoiceNumber,
    DateOnly ServiceDate,
    IReadOnlyList<SaveCommissionItem> Items
) : IRequest<int>;

public record CommissionPreviewItem(
    int CustomerSvcId,
    int CustomerId,
    string CompanyName,
    string ServiceTypeName,
    decimal ServicePrice,
    string FrequencyCode,
    short StartWeek,
    int NumServiceWeek,
    string CommissionType,
    int? EmployeeId,
    string EmployeeName,
    decimal CommissionAmount,
    int PayrollType,
    string RuleDescription,
    bool IsFirstCommission
);

public record SaveCommissionItem(
    int CustomerSvcId,
    int CustomerId,
    string CompanyName,
    string ServiceTypeName,
    string FrequencyCode,
    short StartWeek,
    int NumServiceWeek,
    string CommissionType,
    int? EmployeeId,
    string EmployeeName,
    decimal CommissionAmount,
    decimal ServicePrice,
    int PayrollType,
    bool IsFirstCommission
);

public record CommissionListItem(
    int Id,
    int InvoiceNumber,
    int CustomerId,
    string CompanyName,
    int? EmployeeId,
    string EmployeeName,
    int PayrollType,
    decimal CommissionAmount,
    decimal ServicePrice,
    string ServiceTypeName,
    DateTime ServiceDate,
    short WeekNumber,
    string FrequencyCode,
    short StartWeek
);
