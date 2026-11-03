#pragma once
// Fake HTTPClient (the firmware model). Requests go to the small stand-in server on the page
// (frontend/model/server.js), which answers the same device API as the Spring backend.
#include <string>
#include <vector>

#include "Arduino.h"
#include "WiFi.h"

#define HTTPC_ERROR_CONNECTION_REFUSED (-1)

class HTTPClient {
 public:
  bool begin(WiFiClient &client, const String &url);
  void setConnectTimeout(int ms) { (void)ms; }
  void setTimeout(uint16_t ms) { (void)ms; }
  void addHeader(const String &name, const String &value);
  int GET();
  int POST(const String &body);
  String getString() { return response_; }
  void end() {}

 private:
  int request(const char *method, const String &body);
  String url_;
  std::vector<std::pair<std::string, std::string>> headers_;
  String response_;
};
