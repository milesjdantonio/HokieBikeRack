#pragma once
// Fake FreeRTOS (the firmware model). The browser has one thread, so the network task is run
// in turns with loop(): every vTaskDelay() hands control back to the scheduler in hw.cpp.
// Mutexes are not needed with one thread, so they do nothing.
#include <stdint.h>

typedef uint32_t TickType_t;
typedef int BaseType_t;
typedef void *SemaphoreHandle_t;
typedef void *TaskHandle_t;
typedef void (*TaskFunction_t)(void *);

#define portMAX_DELAY 0xffffffffu
#define pdPASS 1
#define pdTRUE 1
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))  // ESP32 Arduino: 1 tick = 1 ms

void vTaskDelay(TickType_t ticks);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t task, const char *name, uint32_t stackDepth,
                                   void *parameter, unsigned priority, TaskHandle_t *handle,
                                   int core);
