package edu.vt.hokiebikerack.devices;

import java.util.UUID;

/** "Who is calling" for device requests: a verified device and the rack it belongs to. */
public record DevicePrincipal(UUID deviceId, UUID rackId) {}
