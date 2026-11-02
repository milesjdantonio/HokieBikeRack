#pragma once
// Loads your local config.h (Wi-Fi, API URL, device token) if it exists,
// and fills in empty defaults for anything missing so the code still builds.
// To set up: copy config.example.h to config.h and fill it in. Never commit config.h.
// Shared file: tell your teammate before changing it.

#if __has_include("config.h")
#include "config.h"
#endif

#ifndef HBR_API_BASE_URL
#define HBR_API_BASE_URL ""
#endif
#ifndef HBR_DEVICE_ID
#define HBR_DEVICE_ID ""
#endif
#ifndef HBR_DEVICE_TOKEN
#define HBR_DEVICE_TOKEN ""
#endif
#ifndef HBR_API_ROOT_CA
#define HBR_API_ROOT_CA ""
#endif
#ifndef HBR_WIFI_SSID
#define HBR_WIFI_SSID ""
#endif
#ifndef HBR_WIFI_PASSWORD
#define HBR_WIFI_PASSWORD ""
#endif
