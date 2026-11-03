#pragma once
// Fake FreeRTOS mutexes (the firmware model): one thread, so nothing to guard.
#include "FreeRTOS.h"

SemaphoreHandle_t xSemaphoreCreateMutex();
BaseType_t xSemaphoreTake(SemaphoreHandle_t mutex, TickType_t wait);
BaseType_t xSemaphoreGive(SemaphoreHandle_t mutex);
