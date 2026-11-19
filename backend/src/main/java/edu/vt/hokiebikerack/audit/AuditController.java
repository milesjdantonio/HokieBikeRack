package edu.vt.hokiebikerack.audit;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin API: the audit log (who changed what, when), newest first, a page at a time. */
@RestController
@RequestMapping("/api/v1/audit-log")
@Validated
public class AuditController {
  private final AuditService audit;

  public AuditController(AuditService audit) {
    this.audit = audit;
  }

  /** GET /api/v1/audit-log?page=0&size=50 */
  @GetMapping
  public AuditService.AuditPage list(@RequestParam(defaultValue = "0") @Min(0) int page,
                                     @RequestParam(defaultValue = "50") @Min(1) @Max(200) int size) {
    return audit.list(page, size);
  }
}
