#pragma once
// 3-axis accelerometer for detecting tampering. Owner: Person B
// Tamper events get recorded and reported. They must NEVER move the lock.

// One reading from the accelerometer.
struct AccelReading {
  float x;
  float y;
  float z;
};

// Call once from setup().
void tamperSensorSetup();

// Returns true if a reading was taken, and fills in `reading`.
bool tamperSensorRead(AccelReading& reading);

// Returns true if this reading looks like tampering (not ordinary bumps).
bool tamperSensorIsTamper(const AccelReading& reading);
