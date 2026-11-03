package edu.vt.hokiebikerack.racks;

import edu.vt.hokiebikerack.racks.RackModels.*;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/**
 * Admin API for racks and their devices. Security rules (who may call) live in
 * SecurityConfig: GET = ADMIN or VIEWER, POST/PATCH = ADMIN.
 */
@RestController
@RequestMapping("/api/v1/racks")
public class RackController {
  private final RackService racks;

  public RackController(RackService racks) {
    this.racks = racks;
  }

  @GetMapping
  public List<RackSummary> list() {
    return racks.list();
  }

  @GetMapping("/{rackId}")
  public RackDetail get(@PathVariable UUID rackId) {
    return racks.get(rackId);
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public RackDetail create(@Valid @RequestBody CreateRack body, Principal user) {
    return racks.create(body, user.getName());
  }

  @PatchMapping("/{rackId}")
  public RackDetail update(@PathVariable UUID rackId, @Valid @RequestBody UpdateRack body, Principal user) {
    return racks.update(rackId, body, user.getName());
  }

  /** "It's really back": clears UNCONFIRMED after a rack returns from being offline. */
  @PostMapping("/{rackId}/confirm-online")
  public RackDetail confirmOnline(@PathVariable UUID rackId, Principal user) {
    return racks.confirmOnline(rackId, user.getName());
  }

  @PostMapping("/{rackId}/devices")
  @ResponseStatus(HttpStatus.CREATED)
  public DeviceCredentials addDevice(@PathVariable UUID rackId, @Valid @RequestBody CreateDevice body,
                                     Principal user) {
    return racks.addDevice(rackId, body, user.getName());
  }

  @PostMapping("/{rackId}/devices/{deviceId}/rotate-token")
  public DeviceCredentials rotateToken(@PathVariable UUID rackId, @PathVariable UUID deviceId, Principal user) {
    return racks.rotateToken(rackId, deviceId, user.getName());
  }

  @PatchMapping("/{rackId}/devices/{deviceId}")
  public DeviceView updateDevice(@PathVariable UUID rackId, @PathVariable UUID deviceId,
                                 @Valid @RequestBody UpdateDevice body, Principal user) {
    return racks.updateDevice(rackId, deviceId, body, user.getName());
  }
}
