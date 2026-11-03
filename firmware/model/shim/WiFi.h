#pragma once
// Fake ESP32 Wi-Fi (the firmware model). "The phone hotspot" is a switch on the page.
#include <stdint.h>

#include "Arduino.h"

typedef enum {
  WL_IDLE_STATUS = 0,
  WL_NO_SSID_AVAIL = 1,
  WL_CONNECTED = 3,
  WL_CONNECT_FAILED = 4,
  WL_CONNECTION_LOST = 5,
  WL_DISCONNECTED = 6,
} wl_status_t;

#define WIFI_STA 1

class IPAddress {
 public:
  String toString() const;
};

class WiFiClass {
 public:
  wl_status_t status();
  bool mode(int m);
  bool setSleep(bool enable);
  bool disconnect();
  wl_status_t begin(const char *ssid, const char *password);
  IPAddress localIP();
  int RSSI();
};
extern WiFiClass WiFi;

class WiFiClient {};
