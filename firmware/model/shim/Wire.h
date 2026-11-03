#pragma once
// Fake I2C bus (the firmware model). The "chips" on it (MPU-6050 at 0x68, PN532 at 0x24) are
// emulated in firmware/model/hw.cpp from their datasheets, so the firmware's own register reads
// and writes in src/tamper_sensor.cpp and src/card_reader.cpp run for real.
#include <stddef.h>
#include <stdint.h>

class TwoWire {
 public:
  bool begin(int sda, int scl, uint32_t frequency);
  void beginTransmission(uint8_t address);
  size_t write(uint8_t data);
  uint8_t endTransmission(bool sendStop = true);
  uint8_t requestFrom(uint8_t address, uint8_t count);
  int available();
  int read();
};
extern TwoWire Wire;
