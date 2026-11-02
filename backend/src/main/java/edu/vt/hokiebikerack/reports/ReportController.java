package edu.vt.hokiebikerack.reports;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/reports")
@Validated
public class ReportController {
  private final ReportService reports;

  public ReportController(ReportService reports) {
    this.reports = reports;
  }

  @GetMapping("/summary")
  public ReportService.Summary summary(@RequestParam(defaultValue = "7") @Min(1) @Max(90) int days) {
    return reports.summary(days);
  }
}
