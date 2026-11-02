#include "tamper_sensor.h"

void tamperSensorSetup() {
  // TODO: start the accelerometer once the exact chip and bus are confirmed.
}

bool tamperSensorRead(AccelReading& reading) {
  // TODO: read x, y, z from the sensor.
  reading.x = 0;
  reading.y = 0;
  reading.z = 0;
  return false;  // placeholder: "no reading"
}

bool tamperSensorIsTamper(const AccelReading& reading) {
  // TODO: compare against a calibrated baseline and threshold.
  return false;
}
