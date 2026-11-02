#pragma once
// Example-only checklist. Never commit real Wi-Fi credentials, tokens, or keys.
// TODO: NFC interface and card protocol.
// TODO: vibration sensor and calibration.
// TODO: lock-driver pin after electrical/fail-safe review.
// Copy this file to config.h and fill these values. Keep config.h out of Git.
#define HBR_WIFI_SSID ""
#define HBR_WIFI_PASSWORD ""
#define HBR_API_BASE_URL "https://example.invalid"
#define HBR_DEVICE_ID ""
#define HBR_DEVICE_TOKEN ""
// PEM root CA for the API host. Never use an insecure TLS client in production.
// Must be a #define (like the values above) so device_config.h can see it.
// Paste one quoted line per certificate line, each ending in \n, for example:
//   #define HBR_API_ROOT_CA \
//     "-----BEGIN CERTIFICATE-----\n" \
//     "MIIF...\n" \
//     "-----END CERTIFICATE-----\n"
#define HBR_API_ROOT_CA ""
