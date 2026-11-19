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

  /** Body of New Rider Code: an optional name for the rider. */
  public record IssueCode(@Size(max = 120) String name) {}

  /** The online request form (stand-in for StarRez). */
  public record RequestAccess(
      @jakarta.validation.constraints.NotBlank @Size(max = 120) String name,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Email @Size(max = 160) String email,
      @jakarta.validation.constraints.Pattern(regexp = "^$|\\d{9}", message = "is the 9-digit number on your Hokie Passport")
      String hokiePassportId,
      @Size(max = 500) String note) {}

  /** POST /api/v1/rider/request: the online access form. Public; returns the new rider code. */
  @PostMapping("/rider/request")
  @ResponseStatus(HttpStatus.CREATED)
  public RiderService.RequestResult request(@jakarta.validation.Valid @RequestBody RequestAccess body) {
    return riders.request(body.name(), body.email(), body.hokiePassportId(), body.note());
  }

  /** Approved riders: open the 2-minute window to link their Hokie Passport with one tap. */
  @PostMapping("/rider/link")
  public RiderService.RiderView link(@RequestHeader("X-Rider-Code") String code) {
    return riders.startLink(code);
  }

  /** GET /api/v1/access-requests?status=PENDING */
  @GetMapping("/access-requests")
  public java.util.List<RiderService.AccessRequest> requests(@RequestParam(required = false) String status) {
    return riders.requests(status);
  }

  /** POST /api/v1/access-requests/{id}/approve */
  @PostMapping("/access-requests/{riderId}/approve")
  public RiderService.AccessRequest approve(@PathVariable UUID riderId, Principal user) {
    return riders.decide(riderId, true, user.getName());
  }

  /** POST /api/v1/access-requests/{id}/deny */
  @PostMapping("/access-requests/{riderId}/deny")
  public RiderService.AccessRequest deny(@PathVariable UUID riderId, Principal user) {
    return riders.decide(riderId, false, user.getName());
  }

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
