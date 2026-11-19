package edu.vt.hokiebikerack.incidents;

import edu.vt.hokiebikerack.incidents.IncidentModels.*;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Police incidents. GET = admin or viewer; POST = admin (see SecurityConfig). */
@RestController
@RequestMapping("/api/v1")
public class IncidentController {
  private final IncidentService incidents;

  public IncidentController(IncidentService incidents) {
    this.incidents = incidents;
  }

  /** "Alert Authorities" on a rack's tamper alarm. 409 if an incident is already open for it. */
  @PostMapping("/racks/{rackId}/alert-authorities")
  @ResponseStatus(HttpStatus.CREATED)
  public IncidentDetail alert(@PathVariable UUID rackId, @Valid @RequestBody(required = false) AlertAuthorities body,
                              Principal user) {
    return incidents.alert(rackId, body, user.getName());
  }

  /** GET /api/v1/incidents?open=true: open incidents (open=false: all of them). */
  @GetMapping("/incidents")
  public List<IncidentView> list(@RequestParam(defaultValue = "true") boolean open) {
    return incidents.list(open);
  }

  /** GET /api/v1/incidents/{id}: one incident with its timeline and what the rack saw. */
  @GetMapping("/incidents/{id}")
  public IncidentDetail get(@PathVariable UUID id) {
    return incidents.get(id);
  }

  /** Police: On My Way (EN_ROUTE), On Scene (ON_SCENE), Resolved (RESOLVED). Forward only. */
  @PostMapping("/incidents/{id}/status")
  public IncidentDetail changeStatus(@PathVariable UUID id, @Valid @RequestBody ChangeStatus body, Principal user) {
    return incidents.changeStatus(id, body, user.getName());
  }
}
