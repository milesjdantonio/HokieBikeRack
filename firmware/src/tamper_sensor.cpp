#include "tamper_sensor.h"

#include <Arduino.h>
#include <Wire.h>

// We talk to the MPU-6050 directly with Wire instead of a library: it's only
// a few registers, and it's a good way to learn how I2C sensors work.
// Register numbers come from the "MPU-6000/6050 Register Map" PDF (InvenSense).
namespace {
constexpr uint8_t kAddress = 0x68;      // AD0 pin low (default on GY-521). 0x69 if AD0 high.
constexpr uint8_t kRegConfig = 0x1A;    // digital low-pass filter
constexpr uint8_t kRegAccelConfig = 0x1C;
constexpr uint8_t kRegAccelXOutH = 0x3B;  // 6 bytes: X high, X low, Y high, Y low, Z high, Z low
constexpr uint8_t kRegPowerMgmt1 = 0x6B;
constexpr uint8_t kRegWhoAmI = 0x75;
// ACCEL_CONFIG 0x08 = +/-4 g range -> 8192 counts per g. +/-2 g would clip
// hard knocks; +/-4 g still gives plenty of detail.
constexpr uint8_t kAccelRange4g = 0x08;
constexpr float kCountsPerG = 8192.0f;
constexpr uint32_t kRetryInitEveryMs = 10000;
constexpr uint8_t kFailuresBeforeUnhealthy = 5;

bool healthy = false;
uint8_t failures = 0;
uint32_t lastInitAttemptMs = 0;

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(kAddress);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;  // 0 = the sensor acknowledged
}

bool readRegisters(uint8_t reg, uint8_t *buffer, uint8_t count) {
  Wire.beginTransmission(kAddress);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;  // false = keep the bus (repeated start)
  if (Wire.requestFrom(kAddress, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) buffer[i] = Wire.read();
  return true;
}

bool initSensor() {
  lastInitAttemptMs = millis();
  failures = 0;
  uint8_t who = 0;
  if (!readRegisters(kRegWhoAmI, &who, 1)) return false;
  // A genuine MPU-6050 says 0x68. Many cheap GY-521 boards carry clone chips
  // that say 0x70/0x72/0x98; they work the same for our accelerometer use.
  Serial.print(F("[accel] WHO_AM_I = 0x"));
  Serial.print(who, HEX);
  Serial.println(who == 0x68 ? F(" (MPU-6050)") : F(" (clone?)"));
  // Power-on default is SLEEP mode. 0x01 = wake up, use the gyro's clock (more stable).
  if (!writeRegister(kRegPowerMgmt1, 0x01)) return false;
  delay(10);
  if (!writeRegister(kRegAccelConfig, kAccelRange4g)) return false;
  // Low-pass filter ~44 Hz: smooths out electrical noise but keeps real knocks.
  if (!writeRegister(kRegConfig, 0x03)) return false;
  return true;
}
}  // namespace

bool tamperSensorSetup() {
  healthy = initSensor();
  if (!healthy) Serial.println(F("[accel] MPU-6050 not found. Check SDA (A4) / SCL (A5) / VCC / GND."));
  return healthy;
}

bool tamperSensorHealthy() { return healthy; }

bool tamperSensorRead(AccelReading &reading) {
  if (!healthy) {
    if (millis() - lastInitAttemptMs >= kRetryInitEveryMs) {
      healthy = initSensor();
      if (healthy) Serial.println(F("[accel] sensor is back"));
    }
    return false;
  }
  uint8_t raw[6];
  if (!readRegisters(kRegAccelXOutH, raw, 6)) {
    if (++failures >= kFailuresBeforeUnhealthy) {
      healthy = false;
      Serial.println(F("[accel] sensor stopped answering; will retry"));
    }
    return false;
  }
  failures = 0;
  // Each axis is a signed 16-bit number, high byte first ("big-endian").
  int16_t x = static_cast<int16_t>((raw[0] << 8) | raw[1]);
  int16_t y = static_cast<int16_t>((raw[2] << 8) | raw[3]);
  int16_t z = static_cast<int16_t>((raw[4] << 8) | raw[5]);
  reading.x = x / kCountsPerG;
  reading.y = y / kCountsPerG;
  reading.z = z / kCountsPerG;
  return true;
}
