#pragma once
// Fake ESP32Servo library (the firmware model). attach() and write() follow the real library
// (.pio/libdeps/esp32dev/ESP32Servo/src/ESP32Servo.cpp): values under 500 are degrees, mapped
// onto the attach() pulse range; the range is clamped to 500..2500 us.
#define MIN_PULSE_WIDTH 500
#define MAX_PULSE_WIDTH 2500

class Servo {
 public:
  void setPeriodHertz(int hz);
  int attach(int pin, int minUs = 544, int maxUs = 2400);
  void write(int value);
  void writeMicroseconds(int us);
  int read();
  bool attached() const { return pin_ >= 0; }

 private:
  int pin_ = -1;
  int min_ = 544;
  int max_ = 2400;
  int us_ = 1500;
};
