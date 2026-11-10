#pragma once
// Fake Arduino Servo library for AVR (the firmware model). attach() and write() follow the real
// library (.pio/libdeps/uno/Servo/src/avr/Servo.cpp): values under 544 are degrees, mapped onto
// the attach() pulse range; attach() starts the pulse at 1500 us; pulses repeat at 50 Hz
// (Timer1, which is why PWM on pins 9 and 10 stops working on a real Uno).
#include <stdint.h>

#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500
#define REFRESH_INTERVAL 20000  // us between pulses = 50 Hz

class Servo {
 public:
  uint8_t attach(int pin);
  uint8_t attach(int pin, int minUs, int maxUs);
  void detach();
  void write(int value);
  void writeMicroseconds(int us);
  int read();
  bool attached() const { return pin_ >= 0; }

 private:
  int pin_ = -1;
  int min_ = MIN_PULSE_WIDTH;
  int max_ = MAX_PULSE_WIDTH;
  int us_ = DEFAULT_PULSE_WIDTH;
};
