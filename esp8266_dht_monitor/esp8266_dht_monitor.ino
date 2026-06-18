#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <DHT.h>

// แก้ 4 ค่านี้ก่อนอัปโหลด
const char* WIFI_NAME = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://192.168.1.25:3000/api/readings";
const char* DEVICE_ID = "ESP-STERILE-ROOM-01";

// ต่อขา OUT ของเซนเซอร์เข้ากับ D4 บนบอร์ด NodeMCU
#define DHT_PIN D4

// ถ้าอ่านค่าไม่ได้ ลองเปลี่ยน DHT22 เป็น DHT11
#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  delay(200);

  dht.begin();
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);

  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Connected. ESP IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT read failed");
    delay(10000);
    return;
  }

  Serial.print("Temp: ");
  Serial.print(temperature);
  Serial.print(" C, RH: ");
  Serial.print(humidity);
  Serial.println(" %");

  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;

    http.begin(client, SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    String body = "{";
    body += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
    body += "\"temperature\":" + String(temperature, 1) + ",";
    body += "\"humidity\":" + String(humidity, 1);
    body += "}";

    int statusCode = http.POST(body);
    Serial.print("POST status: ");
    Serial.println(statusCode);
    Serial.println(http.getString());
    http.end();
  } else {
    Serial.println("WiFi disconnected");
  }

  delay(300000); // ส่งข้อมูลทุก 5 นาที
}
