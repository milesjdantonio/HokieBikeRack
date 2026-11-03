#pragma once
// Fake Arduino core for the firmware model (firmware/model/README.md).
//
// The real firmware in src/ is compiled UNCHANGED against these files instead of the ESP32
// Arduino core, so it can run in a browser. Everything here imitates hardware or a library:
// a virtual clock (millis, delay), GPIO pins, the serial port and the String class. None of the
// rack's behaviour lives here; that all stays in src/ and lib/hbr_logic/.
#include <math.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <string>

#include "WString.h"
#include "freertos/FreeRTOS.h"  // the ESP32 core includes FreeRTOS from Arduino.h too

using std::max;
using std::min;

#define HIGH 1
#define LOW 0
#define INPUT 0x01
#define OUTPUT 0x03
#define INPUT_PULLUP 0x05

// ---- virtual clock: time only moves when the model says so ----
uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield();

// ---- GPIO ----
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);

long map(long x, long inMin, long inMax, long outMin, long outMax);

// ---- Print: what Serial and File have in common (ArduinoJson writes through it) ----
class Print {
 public:
  virtual ~Print() = default;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size) {
    size_t n = 0;
    while (size--) n += write(*buffer++);
    return n;
  }
  size_t write(const char *s) { return s ? write(reinterpret_cast<const uint8_t *>(s), strlen(s)) : 0; }
  size_t print(const char *s) { return write(s); }
  size_t print(const String &s) { return write(reinterpret_cast<const uint8_t *>(s.c_str()), s.length()); }
  size_t print(char c) { return write(static_cast<uint8_t>(c)); }
  size_t print(int v) { return printf("%d", v); }
  size_t print(unsigned v) { return printf("%u", v); }
  size_t print(long v) { return printf("%ld", v); }
  size_t print(unsigned long v) { return printf("%lu", v); }
  size_t print(double v, int digits = 2) { return printf("%.*f", digits, v); }
  size_t println() { return write('\n'); }
  template <typename T>
  size_t println(const T &v) { return print(v) + println(); }
  size_t printf(const char *format, ...) __attribute__((format(printf, 2, 3)));
  virtual void flush() {}
};

// ---- the serial port (USB to the laptop) ----
class HardwareSerial : public Print {
 public:
  void begin(unsigned long baud);
  int available();
  int read();
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buffer, size_t size) override;
  using Print::write;
  operator bool() const { return true; }
};
extern HardwareSerial Serial;

// ---- the ESP object: heap size and restart ----
class EspClass {
 public:
  uint32_t getFreeHeap();
  void restart();
};
extern EspClass ESP;
