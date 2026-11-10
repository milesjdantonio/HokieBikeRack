#pragma once
// Fake I2C bus with the AVR Wire library's functions (the firmware model). The "chips" on it
// (MPU-6050 at 0x68, PN532 at 0x24) are emulated in firmware/model/hw.cpp from their
// datasheets, so the firmware's own register reads and writes in src/tamper_sensor.cpp and
// src/card_reader.cpp run for real. On the Uno, SDA and SCL are fixed: A4 and A5.
#include <stddef.h>
#include <stdint.h>

#define WIRE_HAS_TIMEOUT 1  // like Arduino AVR core 1.8.3 and later

class TwoWire {
 public:
  void begin();
  void setClock(uint32_t frequency);
  void setWireTimeout(uint32_t timeoutUs = 25000, bool resetWithTimeout = false);
  void beginTransmission(uint8_t address);
  void beginTransmission(int address) { beginTransmission(static_cast<uint8_t>(address)); }
  size_t write(uint8_t data);
  uint8_t endTransmission(uint8_t sendStop);
  uint8_t endTransmission() { return endTransmission(static_cast<uint8_t>(1)); }
  uint8_t requestFrom(uint8_t address, uint8_t count);
  uint8_t requestFrom(int address, int count) {
    return requestFrom(static_cast<uint8_t>(address), static_cast<uint8_t>(count));
  }
  int available();
  int read();
};
extern TwoWire Wire;
