#pragma once
// Fake TLS client (the firmware model). The model server only speaks plain HTTP.
#include "WiFi.h"

class WiFiClientSecure : public WiFiClient {
 public:
  void setCACert(const char *) {}
};
