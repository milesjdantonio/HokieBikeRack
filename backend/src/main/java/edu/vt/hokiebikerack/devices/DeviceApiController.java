package edu.vt.hokiebikerack.devices;

import com.fasterxml.jackson.databind.JsonNode;
import edu.vt.hokiebikerack.events.EventModels.DeviceEventBatch;
import edu.vt.hokiebikerack.events.EventModels.IngestResult;
import edu.vt.hokiebikerack.events.EventService;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * The API the ESP32 talks to. Every call needs "Authorization: Bearer <device token>"
 * (checked by DeviceTokenFilter BEFORE we get here; the token must belong to {deviceId}).
 */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}")
public class DeviceApiController {
  private final EventService events;
  private final DeviceService devices;

  public DeviceApiController(EventService events, DeviceService devices) {
    this.events = events;
    this.devices = devices;
  }

  /** Upload queued events. Safe to retry: duplicates (same event ID) are ignored. */
  @PostMapping("/events")
  public IngestResult uploadEvents(@PathVariable UUID deviceId, @AuthenticationPrincipal DevicePrincipal device,
                                   @Valid @RequestBody DeviceEventBatch batch) {
    devices.touch(device);
    return events.ingest(device, batch.events());
  }

  /** The list of cards allowed at this device's rack, valid for 72 h. */
  @GetMapping("/authorization-snapshot")
  public DeviceService.Snapshot snapshot(@PathVariable UUID deviceId, @AuthenticationPrincipal DevicePrincipal device) {
    devices.touch(device);
    return devices.snapshot(device);
  }

  /** "I'm alive" + health numbers, every 60 s. */
  @PostMapping("/heartbeat")
  public Map<String, Object> heartbeat(@PathVariable UUID deviceId, @AuthenticationPrincipal DevicePrincipal device,
                                       @RequestBody JsonNode body) {
    return devices.heartbeat(device, body);
  }
}
