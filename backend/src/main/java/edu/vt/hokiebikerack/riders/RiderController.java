package edu.vt.hokiebikerack.riders;

import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/**
 * Riders. Issuing a code is an admin action; /rider/me is open to anyone who has a code (the code is
 * the rider's key, see SecurityConfig).
 */
@RestController
@RequestMapping("/api/v1")
public class RiderController {
  private final RiderService riders;

  public RiderController(RiderService riders) {
    this.riders = riders;
  }

  public record IssueCode(@Size(max = 120) String name) {}

  /** Makes (or replaces) the card owner's rider code. The code is in this response only. */
  @PostMapping("/credentials/{credentialId}/rider-code")
  @ResponseStatus(HttpStatus.CREATED)
  public RiderService.RiderCode issue(@PathVariable UUID credentialId, @RequestBody(required = false) IssueCode body,
                                      Principal user) {
    return riders.issueCode(credentialId, body == null ? null : body.name(), user.getName());
  }

  /** The rider app: who am I, my cards, where my bike is, and whether that rack has an alarm. */
  @GetMapping("/rider/me")
  public RiderService.RiderView me(@RequestHeader("X-Rider-Code") String code) {
    return riders.me(code);
  }
}
