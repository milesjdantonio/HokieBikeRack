package edu.vt.hokiebikerack.events;

import edu.vt.hokiebikerack.events.EventModels.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.security.Principal;
import java.time.Instant;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/** Admin API: browse and acknowledge security events. */
@RestController
@RequestMapping("/api/v1/events")
@Validated
public class EventController {
  private final EventService events;

  public EventController(EventService events) {
    this.events = events;
  }

  /** e.g. GET /api/v1/events?rackId=...&severity=HIGH&type=TAMPER&page=0&size=50 */
  @GetMapping
  public EventPage search(
      @RequestParam(required = false) UUID rackId,
      @RequestParam(required = false) EventModels.Severity severity,
      @RequestParam(required = false) String type,
      @RequestParam(required = false) String credentialReference,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
      @RequestParam(required = false) Boolean unacknowledged,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "50") @Min(1) @Max(200) int size) {
    var filter = new EventFilter(rackId, severity == null ? null : severity.name(), type,
        credentialReference, from, to, unacknowledged);
    return events.search(filter, page, size);
  }

  @PostMapping("/{eventId}/acknowledge")
  public EventView acknowledge(@PathVariable UUID eventId, Principal user) {
    return events.acknowledge(eventId, user.getName());
  }

  @PostMapping("/acknowledge-rack/{rackId}")
  public RackHandled acknowledgeRack(@PathVariable UUID rackId, Principal user) {
    return events.acknowledgeAllForRack(rackId, user.getName());
  }
}
