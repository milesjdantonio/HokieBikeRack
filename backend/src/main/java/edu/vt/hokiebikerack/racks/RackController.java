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
 * SecurityConfig: GET = ADMIN or VIEWER, POST/PATCH/DELETE = ADMIN.
 */
@RestController
@RequestMapping("/api/v1/racks")
public class RackController {
  private final RackService racks;

  public RackController(RackService racks) {
    this.racks = racks;
  }

  /** GET /api/v1/racks: every rack with its status, spots and alerts. */
  @GetMapping
  public List<RackSummary> list() {
    return racks.list();
  }

  /** GET /api/v1/racks/{id}: one rack and its lock modules. */
  @GetMapping("/{rackId}")
  public RackDetail get(@PathVariable UUID rackId) {
    return racks.get(rackId);
  }

  /** POST /api/v1/racks: add a rack (name, optional map position and spots). */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public RackDetail create(@Valid @RequestBody CreateRack body, Principal user) {
    return racks.create(body, user.getName());
  }

  /** PATCH /api/v1/racks/{id}: rename, move on the map, change spots. */
  @PatchMapping("/{rackId}")
  public RackDetail update(@PathVariable UUID rackId, @Valid @RequestBody UpdateRack body, Principal user) {
    return racks.update(rackId, body, user.getName());
  }

  /** Removes the rack and everything attached to it (see RackService.delete). Can't be undone. */
  @DeleteMapping("/{rackId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable UUID rackId, Principal user) {
    racks.delete(rackId, user.getName());
  }

  /** "All spots are open now": restarts the tap-in / tap-out count. */
  @PostMapping("/{rackId}/reset-spots")
  public RackDetail resetSpots(@PathVariable UUID rackId, Principal user) {
    return racks.resetSpots(rackId, user.getName());
  }

  /** "It's really back": clears UNCONFIRMED after a rack returns from being offline. */
  @PostMapping("/{rackId}/confirm-online")
  public RackDetail confirmOnline(@PathVariable UUID rackId, Principal user) {
    return racks.confirmOnline(rackId, user.getName());
  }

  /** POST /api/v1/racks/{id}/devices: add a lock module; its token is in this answer only. */
  @PostMapping("/{rackId}/devices")
  @ResponseStatus(HttpStatus.CREATED)
  public DeviceCredentials addDevice(@PathVariable UUID rackId, @Valid @RequestBody CreateDevice body,
                                     Principal user) {
    return racks.addDevice(rackId, body, user.getName());
  }

  /** POST .../devices/{deviceId}/rotate-token: a new device token; the old one stops working. */
  @PostMapping("/{rackId}/devices/{deviceId}/rotate-token")
  public DeviceCredentials rotateToken(@PathVariable UUID rackId, @PathVariable UUID deviceId, Principal user) {
    return racks.rotateToken(rackId, deviceId, user.getName());
  }

  /** PATCH .../devices/{deviceId}: rename a lock module or turn it on/off. */
  @PatchMapping("/{rackId}/devices/{deviceId}")
  public DeviceView updateDevice(@PathVariable UUID rackId, @PathVariable UUID deviceId,
                                 @Valid @RequestBody UpdateDevice body, Principal user) {
    return racks.updateDevice(rackId, deviceId, body, user.getName());
  }
}
