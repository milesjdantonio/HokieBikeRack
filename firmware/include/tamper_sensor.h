#pragma once
// MPU-6050 (GY-521 board) accelerometer driver over I2C. Owner: Person B
// Only READS the sensor. Deciding "is this tampering?" happens in
// lib/hbr_logic/src/tamper_detector (tested on the PC).
// Tamper events get recorded and reported. They must NEVER move the lock.

// One reading from the accelerometer, in g (1 g = gravity).
// A still, flat sensor reads about (0, 0, 1).
struct AccelReading {
  float x;
  float y;
  float z;
};

// Call once from setup(), after Wire.begin(). Returns false if no MPU-6050 answered.
bool tamperSensorSetup();

// Returns true if a reading was taken, and fills in `reading`.
bool tamperSensorRead(AccelReading &reading);

// False if the sensor stopped answering. It retries by itself every 10 s.
bool tamperSensorHealthy();
