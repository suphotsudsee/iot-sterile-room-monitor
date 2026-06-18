#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <EEPROM.h>
#include <DHT.h>

#define DHT_PIN D4
#define DHT_TYPE DHT11

#define EEPROM_SIZE 768
#define CONFIG_MAGIC 0x53484D31

struct DeviceConfig {
  uint32_t magic;
  char wifiName[64];
  char wifiPassword[64];
  char serverUrl[180];
  char deviceId[48];
  char deviceKey[64];
};

DHT dht(DHT_PIN, DHT_TYPE);
ESP8266WebServer webServer(80);
DeviceConfig config;

unsigned long lastSendAt = 0;
const unsigned long SEND_INTERVAL_MS = 300000; // 5 minutes

String htmlEscape(String value) {
  value.replace("&", "&amp;");
  value.replace("<", "&lt;");
  value.replace(">", "&gt;");
  value.replace("\"", "&quot;");
  return value;
}

void copyField(char* target, size_t size, const String& value) {
  memset(target, 0, size);
  value.substring(0, size - 1).toCharArray(target, size);
}

bool hasConfig() {
  return config.magic == CONFIG_MAGIC && strlen(config.wifiName) > 0 && strlen(config.serverUrl) > 0;
}

void loadConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, config);
  if (config.magic != CONFIG_MAGIC) {
    memset(&config, 0, sizeof(config));
    config.magic = CONFIG_MAGIC;
    copyField(config.deviceId, sizeof(config.deviceId), "ESP-STERILE-ROOM-01");
    copyField(config.deviceKey, sizeof(config.deviceKey), "");
    copyField(config.serverUrl, sizeof(config.serverUrl), "http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io/api/readings");
  }
}

void saveConfig() {
  config.magic = CONFIG_MAGIC;
  EEPROM.put(0, config);
  EEPROM.commit();
}

String configPage(String message = "") {
  String page = "<!doctype html><html><head><meta charset='utf-8'>";
  page += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP Sterile Room Setup</title>";
  page += "<style>body{font-family:Arial,sans-serif;margin:24px;background:#f2f6fb;color:#102044}";
  page += "form{max-width:520px;background:#fff;padding:18px;border:1px solid #bdd0ee;border-radius:10px}";
  page += "label{display:block;font-weight:700;margin-top:12px}input{width:100%;box-sizing:border-box;padding:10px;margin-top:6px}";
  page += "button{margin-top:18px;padding:10px 16px;background:#0b4ea2;color:#fff;border:0;border-radius:6px;font-weight:700}";
  page += ".msg{padding:10px;background:#e8f6ea;border:1px solid #88c990;border-radius:6px}</style></head><body>";
  page += "<h2>ESP Sterile Room Setup</h2>";
  page += "<p>กรอกค่า WiFi และ URL เว็บ แล้วกด Save</p>";
  if (message.length()) page += "<p class='msg'>" + htmlEscape(message) + "</p>";
  page += "<form method='post' action='/save'>";
  page += "<label>WiFi Name</label><input name='wifiName' value='" + htmlEscape(config.wifiName) + "' required>";
  page += "<label>WiFi Password</label><input name='wifiPassword' type='password' value='" + htmlEscape(config.wifiPassword) + "'>";
  page += "<label>Server URL</label><input name='serverUrl' value='" + htmlEscape(config.serverUrl) + "' required>";
  page += "<label>Device ID</label><input name='deviceId' value='" + htmlEscape(config.deviceId) + "' required>";
  page += "<label>Device Key</label><input name='deviceKey' value='" + htmlEscape(config.deviceKey) + "' placeholder='copy from web dashboard'>";
  page += "<button type='submit'>Save & Restart</button></form>";
  page += "<p>Current ESP IP: " + WiFi.localIP().toString() + "</p>";
  page += "</body></html>";
  return page;
}

void handleRoot() {
  webServer.send(200, "text/html; charset=utf-8", configPage());
}

void handleSave() {
  copyField(config.wifiName, sizeof(config.wifiName), webServer.arg("wifiName"));
  copyField(config.wifiPassword, sizeof(config.wifiPassword), webServer.arg("wifiPassword"));
  copyField(config.serverUrl, sizeof(config.serverUrl), webServer.arg("serverUrl"));
  copyField(config.deviceId, sizeof(config.deviceId), webServer.arg("deviceId"));
  copyField(config.deviceKey, sizeof(config.deviceKey), webServer.arg("deviceKey"));
  saveConfig();
  webServer.send(200, "text/html; charset=utf-8", configPage("Saved. ESP will restart now."));
  delay(1000);
  ESP.restart();
}

void startConfigServer() {
  webServer.on("/", HTTP_GET, handleRoot);
  webServer.on("/config", HTTP_GET, handleRoot);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.begin();
}

void startSetupAccessPoint() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("ESP-STERILE-SETUP", "12345678");
  startConfigServer();
  Serial.println("Setup WiFi started");
  Serial.println("SSID: ESP-STERILE-SETUP");
  Serial.println("Password: 12345678");
  Serial.println("Open: http://192.168.4.1");
}

bool connectWiFi() {
  if (!hasConfig()) return false;

  WiFi.mode(WIFI_STA);
  WiFi.begin(config.wifiName, config.wifiPassword);
  Serial.print("Connecting WiFi");

  for (int i = 0; i < 40; i++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.print("Connected. ESP IP: ");
      Serial.println(WiFi.localIP());
      return true;
    }
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connect failed");
  return false;
}

int postReading(float temperature, float humidity) {
  HTTPClient http;
  std::unique_ptr<BearSSL::WiFiClientSecure> secureClient;
  WiFiClient plainClient;

  String url = String(config.serverUrl);
  bool https = url.startsWith("https://");

  if (https) {
    secureClient.reset(new BearSSL::WiFiClientSecure);
    secureClient->setInsecure();
    http.begin(*secureClient, url);
  } else {
    http.begin(plainClient, url);
  }

  http.addHeader("Content-Type", "application/json");

  String body = "{";
  body += "\"deviceId\":\"" + String(config.deviceId) + "\",";
  body += "\"deviceKey\":\"" + String(config.deviceKey) + "\",";
  body += "\"temperature\":" + String(temperature, 1) + ",";
  body += "\"humidity\":" + String(humidity, 1);
  body += "}";

  int statusCode = http.POST(body);
  Serial.print("POST status: ");
  Serial.println(statusCode);
  Serial.println(http.getString());
  http.end();
  return statusCode;
}

void sendReadingNow() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT read failed");
    return;
  }

  Serial.print("Temp: ");
  Serial.print(temperature);
  Serial.print(" C, RH: ");
  Serial.print(humidity);
  Serial.println(" %");

  if (WiFi.status() == WL_CONNECTED) {
    postReading(temperature, humidity);
  } else {
    Serial.println("WiFi disconnected");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  dht.begin();
  loadConfig();

  if (connectWiFi()) {
    startConfigServer();
    Serial.print("Config page: http://");
    Serial.println(WiFi.localIP());
    sendReadingNow();
    lastSendAt = millis();
  } else {
    startSetupAccessPoint();
  }
}

void loop() {
  webServer.handleClient();

  if (WiFi.status() == WL_CONNECTED && millis() - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = millis();
    sendReadingNow();
  }
}
