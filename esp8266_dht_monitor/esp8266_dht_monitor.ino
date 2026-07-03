#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <EEPROM.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define USE_BLYNK 0
#define BLYNK_PRINT Serial
#if USE_BLYNK
#include <BlynkSimpleEsp8266.h>
#endif

#define DHT_PIN D2
#define DHT_TYPE DHT22
#define LCD_SDA_PIN D5
#define LCD_SCL_PIN D6
#define LCD_ADDRESS 0x27

#define EEPROM_SIZE 1024
#define CONFIG_MAGIC 0x53484D32

#define BLYNK_TEMP_VPIN 0
#define BLYNK_RH_VPIN 1
#define BLYNK_STATUS_VPIN 2

struct DeviceConfig {
  uint32_t magic;
  char wifiName[64];
  char wifiPassword[64];
  char serverUrl[180];
  char deviceId[48];
  char deviceKey[64];
  char blynkToken[80];
  uint8_t blynkEnabled;
};

DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);
ESP8266WebServer webServer(80);
DeviceConfig config;

unsigned long lastSendAt = 0;
const unsigned long SEND_INTERVAL_MS = 300000; // 5 minutes

void saveConfig();

void lcdPrintLine(uint8_t row, String text) {
  if (text.length() > 16) text = text.substring(0, 16);
  lcd.setCursor(0, row);
  lcd.print(text);
  for (int i = text.length(); i < 16; i++) lcd.print(" ");
}

void showStatus(String line1, String line2) {
  lcdPrintLine(0, line1);
  lcdPrintLine(1, line2);
}

void showReading(float temperature, float humidity) {
  lcdPrintLine(0, "Temp: " + String(temperature, 1) + " C");
  lcdPrintLine(1, "RH:   " + String(humidity, 1) + " %");
}

bool scanI2cForLcd() {
  bool found = false;
  Serial.println("I2C scan started");
  Serial.print("SDA pin: D5, SCL pin: D6, configured LCD address: 0x");
  Serial.println(LCD_ADDRESS, HEX);

  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("I2C device found at 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      found = true;
    }
  }

  if (!found) {
    Serial.println("No I2C device found. Check LCD VCC/GND/SDA/SCL wiring.");
  }
  Serial.println("I2C scan finished");
  return found;
}

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

bool hasBlynkConfig() {
  return config.blynkEnabled == 1 && strlen(config.blynkToken) > 0;
}

bool isPrintableAscii(const char* value, size_t size) {
  for (size_t i = 0; i < size && value[i] != '\0'; i++) {
    if (value[i] < 32 || value[i] > 126) return false;
  }
  return true;
}

void loadConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, config);
  if (config.magic != CONFIG_MAGIC) {
    memset(&config, 0, sizeof(config));
    config.magic = CONFIG_MAGIC;
    copyField(config.deviceId, sizeof(config.deviceId), "ESP-STERILE-ROOM-01");
    copyField(config.deviceKey, sizeof(config.deviceKey), "");
    copyField(config.blynkToken, sizeof(config.blynkToken), "");
    config.blynkEnabled = 0;
    copyField(config.serverUrl, sizeof(config.serverUrl), "http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io/api/readings");
    saveConfig();
    return;
  }

  if (!isPrintableAscii(config.wifiName, sizeof(config.wifiName))) copyField(config.wifiName, sizeof(config.wifiName), "");
  if (!isPrintableAscii(config.wifiPassword, sizeof(config.wifiPassword))) copyField(config.wifiPassword, sizeof(config.wifiPassword), "");
  if (!isPrintableAscii(config.serverUrl, sizeof(config.serverUrl))) copyField(config.serverUrl, sizeof(config.serverUrl), "http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io/api/readings");
  if (!isPrintableAscii(config.deviceId, sizeof(config.deviceId))) copyField(config.deviceId, sizeof(config.deviceId), "ESP-STERILE-ROOM-01");
  if (!isPrintableAscii(config.deviceKey, sizeof(config.deviceKey))) {
    copyField(config.deviceKey, sizeof(config.deviceKey), "");
    saveConfig();
  }
  if (!isPrintableAscii(config.blynkToken, sizeof(config.blynkToken))) {
    copyField(config.blynkToken, sizeof(config.blynkToken), "");
    config.blynkEnabled = 0;
    saveConfig();
  }
  if (config.blynkEnabled != 0 && config.blynkEnabled != 1) {
    config.blynkEnabled = 0;
    saveConfig();
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
  page += "<label><input name='blynkEnabled' type='checkbox' value='1'";
  if (config.blynkEnabled == 1) page += " checked";
  page += " style='width:auto;margin-right:8px'>Enable Blynk IoT</label>";
  page += "<label>Blynk Auth Token</label><input name='blynkToken' value='" + htmlEscape(config.blynkToken) + "' placeholder='from Blynk device info'>";
  page += "<p>Virtual Pins: V0 = Temp C, V1 = RH %, V2 = status</p>";
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
  copyField(config.blynkToken, sizeof(config.blynkToken), webServer.arg("blynkToken"));
  config.blynkEnabled = webServer.hasArg("blynkEnabled") ? 1 : 0;
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
  showStatus("SETUP WIFI", "192.168.4.1");
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
  showStatus("Connecting WiFi", config.wifiName);

  for (int i = 0; i < 40; i++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.print("Connected. ESP IP: ");
      Serial.println(WiFi.localIP());
      showStatus("WiFi Connected", WiFi.localIP().toString());
      return true;
    }
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connect failed");
  showStatus("WiFi Failed", "Open setup AP");
  return false;
}

int postReading(float temperature, float humidity) {
  if (strlen(config.deviceKey) == 0) {
    Serial.println("Device Key is empty. Open setup page and paste DEV key from web.");
    showStatus("Missing DEV Key", "Open setup page");
    return -2;
  }

  HTTPClient http;
  std::unique_ptr<BearSSL::WiFiClientSecure> secureClient;
  WiFiClient plainClient;

  String url = String(config.serverUrl);
  bool https = url.startsWith("https://");
  String keyText = String(config.deviceKey);

  Serial.print("POST URL: ");
  Serial.println(url);
  Serial.print("Device ID: ");
  Serial.println(config.deviceId);
  Serial.print("Device Key: ");
  Serial.print(keyText.substring(0, 8));
  Serial.println(keyText.length() > 8 ? "..." : "");

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
  if (statusCode < 0) {
    Serial.print("POST error: ");
    Serial.println(http.errorToString(statusCode));
  }
  Serial.println(http.getString());
  http.end();
  return statusCode;
}

void connectBlynk() {
#if USE_BLYNK
  if (!hasBlynkConfig() || WiFi.status() != WL_CONNECTED) return;
  Serial.println("Blynk config started");
  Blynk.config(config.blynkToken);
  if (Blynk.connect(5000)) {
    Serial.println("Blynk connected");
    Blynk.virtualWrite(BLYNK_STATUS_VPIN, "online");
  } else {
    Serial.println("Blynk connect failed");
  }
#else
  if (hasBlynkConfig()) {
    Serial.println("Blynk token is set, but USE_BLYNK is 0. Set USE_BLYNK to 1 and install Blynk library.");
  }
#endif
}

void sendBlynkReading(float temperature, float humidity) {
#if USE_BLYNK
  if (!hasBlynkConfig() || WiFi.status() != WL_CONNECTED) return;
  if (!Blynk.connected()) Blynk.connect(3000);
  if (!Blynk.connected()) {
    Serial.println("Blynk not connected. Skip Blynk update.");
    return;
  }
  Blynk.virtualWrite(BLYNK_TEMP_VPIN, temperature);
  Blynk.virtualWrite(BLYNK_RH_VPIN, humidity);
  Blynk.virtualWrite(BLYNK_STATUS_VPIN, "updated");
  Serial.println("Blynk updated");
#endif
}

void sendReadingNow() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT read failed");
    showStatus("DHT read failed", "Check sensor");
    return;
  }

  Serial.print("Temp: ");
  Serial.print(temperature);
  Serial.print(" C, RH: ");
  Serial.print(humidity);
  Serial.println(" %");

  if (WiFi.status() == WL_CONNECTED) {
    showReading(temperature, humidity);
    int statusCode = postReading(temperature, humidity);
    sendBlynkReading(temperature, humidity);
    if (statusCode == 201 || statusCode == 200) {
      showReading(temperature, humidity);
    } else {
      showReading(temperature, humidity);
    }
  } else {
    Serial.println("WiFi disconnected");
    showReading(temperature, humidity);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  scanI2cForLcd();
  Serial.println("LCD init started");
  lcd.init();
  lcd.backlight();
  Serial.println("LCD init finished");
  showStatus("Sterile Monitor", "Starting...");

  dht.begin();
  loadConfig();

  if (connectWiFi()) {
    startConfigServer();
    Serial.print("Config page: http://");
    Serial.println(WiFi.localIP());
    connectBlynk();
    sendReadingNow();
    lastSendAt = millis();
  } else {
    startSetupAccessPoint();
  }
}

void loop() {
  webServer.handleClient();
#if USE_BLYNK
  if (WiFi.status() == WL_CONNECTED && hasBlynkConfig()) {
    Blynk.run();
  }
#endif

  if (WiFi.status() == WL_CONNECTED && millis() - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = millis();
    sendReadingNow();
  }
}
