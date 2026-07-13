# Sterile Storage Room IoT SaaS

ระบบติดตามอุณหภูมิและความชื้นจาก ESP8266 สำหรับหลายโรงพยาบาล

## ความสามารถ

- Login ผู้ดูแลระบบ
- เพิ่มหลายโรงพยาบาล
- เพิ่มหลายห้องต่อโรงพยาบาล
- เพิ่มอุปกรณ์ ESP ต่อห้อง
- สร้าง Device Key ให้ ESP
- รับข้อมูลผ่าน `POST /api/readings`
- แยกข้อมูลตามโรงพยาบาลและห้อง
- แจ้งเตือนในเว็บและส่ง Webhook เมื่อ Temp/RH ผิดเกณฑ์
- Export รายงานรายเดือนเป็น CSV
- เก็บข้อมูลใน database file ที่ mount อยู่ใน `/app/data`

## URL สำหรับ ESP

```text
http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io/api/readings
```

ESP ต้องส่งข้อมูลแบบนี้:

```json
{
  "deviceId": "ESP-STERILE-ROOM-01",
  "deviceKey": "copy-from-dashboard",
  "temperature": 23.4,
  "humidity": 51.2
}
```

## Login เริ่มต้น

ตั้งผ่าน environment variables:

```text
ADMIN_EMAIL=admin@phoubon.in.th
ADMIN_PASSWORD=admin123
```

เมื่อ deploy แล้วควรเปลี่ยน password ทันทีใน environment ของ Coolify

## Deploy บน Coolify

1. เข้า `https://coolify.phoubon.in.th`
2. Add Resource > Application
3. เลือก Git repository:

```text
https://github.com/suphotsudsee/iot-sterile-room-monitor
```

4. Build Pack เลือก `Dockerfile`
5. Port ใช้:

```text
3000
```

6. ตั้ง domain เป็น:

```text
ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io
```

7. เพิ่ม Storage แบบ Volume Mount:

```text
Source: sterile-room-monitor-data
Destination: /app/data
```

8. เพิ่ม Environment Variables:

```text
PORT=3000
DATA_DIR=/app/data
ADMIN_EMAIL=admin@phoubon.in.th
ADMIN_PASSWORD=ตั้งรหัสจริง
APP_PUBLIC_URL=http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io
ALERT_WEBHOOK_URL=
ALERT_WEBHOOK_TOKEN=
ALERT_COOLDOWN_MINUTES=30
```

9. Deploy

## ระบบแจ้งเตือนแยกตามโรงพยาบาล

เมื่อ ESP ส่งค่าเข้ามาแล้ว Temp/RH ผิดเกณฑ์ ระบบจะ:

1. บันทึก alert ในหน้าเว็บ
2. ส่ง webhook ไปยัง URL ของโรงพยาบาลนั้น ถ้าตั้งค่าไว้

ตั้งค่าในหน้าเว็บ:

1. Login ด้วย `system_admin` หรือ `hospital_admin`
2. เลือกโรงพยาบาล
3. ไปที่ `แจ้งเตือนของ รพ.`
4. ถ้าต้องการส่ง LINE โดยตรง ให้ใส่ `LINE Channel Access Token` และ `LINE User ID หรือ Group ID`
5. ถ้าต้องการส่งผ่านระบบอื่น ให้ใส่ `Webhook URL`, `Token` ถ้ามี
6. ตั้ง cooldown แล้วกด `บันทึกแจ้งเตือน`
7. กด `ทดสอบแจ้งเตือน` เพื่อตรวจว่าปลายทางรับข้อความได้

ถ้าตั้ง LINE ครบ ระบบจะส่งผ่าน LINE ก่อน ถ้าไม่ได้ตั้ง LINE แต่มี Webhook URL ระบบจะส่ง webhook

ค่าที่ต้องใช้สำหรับ LINE:

```text
LINE Channel Access Token = token จาก LINE Developers Console > Messaging API
LINE User ID หรือ Group ID = ปลายทางที่ต้องการให้ bot ส่งข้อความไป
```

LINE Messaging API ใช้ endpoint:

```text
https://api.line.me/v2/bot/message/push
```

โดยระบบจะส่งข้อความแบบ text message ไปยังค่า `LINE User ID หรือ Group ID`

ค่าใน Coolify ด้านล่างเป็น fallback กลาง ถ้าโรงพยาบาลนั้นยังไม่ได้ตั้ง webhook ของตัวเอง:

```text
ALERT_WEBHOOK_URL=https://your-webhook-url
ALERT_WEBHOOK_TOKEN=optional-secret-token
ALERT_COOLDOWN_MINUTES=30
APP_PUBLIC_URL=http://ymxbo5qt3r0g1nnlv5u0q7v6.110.164.222.217.sslip.io
```

Payload ที่ส่งไป webhook:

```json
{
  "event": "sterile_room_alert",
  "level": "critical",
  "message": "ESP-STERILE-ROOM-01: Temp สูง 29.1°C, RH สูง 72.4%",
  "hospital": "ชื่อโรงพยาบาล",
  "room": "ชื่อห้อง",
  "device": "ชื่ออุปกรณ์",
  "deviceId": "ESP-STERILE-ROOM-01",
  "temperature": 29.1,
  "humidity": 72.4,
  "timestamp": "2026-06-18T00:00:00.000Z",
  "appUrl": "http://..."
}
```

ถ้าต้องการทดสอบ webhook ด้วย API ให้ login ด้วย `system_admin` หรือ `hospital_admin` แล้วเรียก:

```text
POST /api/notifications/test?hospitalId=HOSPITAL_ID
```

ค่า `ALERT_COOLDOWN_MINUTES=30` หมายถึง alert ระดับเดิมจากอุปกรณ์เดิมจะไม่ส่งซ้ำถี่เกิน 30 นาที แต่ในหน้าเว็บยังบันทึก alert ทุกครั้ง

## วิธีเพิ่ม ESP ให้โรงพยาบาล

1. Login เข้าเว็บ
2. เพิ่มโรงพยาบาล
3. เพิ่มห้อง
4. เพิ่มอุปกรณ์ ESP
5. Copy `Device Key`
6. เข้า WiFi setup ของ ESP:

```text
SSID: ESP-STERILE-SETUP
Password: 12345678
URL: http://192.168.4.1
```

7. กรอก:

```text
WiFi Name
WiFi Password
Server URL
Device ID
Device Key
```

8. Save & Restart

ถ้า ESP มี `Device ID` และ `Device Key` เดิมอยู่แล้ว ให้กรอกทั้งสองค่าในแบบฟอร์ม `เพิ่ม ESP`
บนเว็บได้ทันที ระบบจะนำคีย์เดิมมาใช้โดยไม่ต้องเข้า WiFi setup ของ ESP ใหม่ หากเว้นช่อง
`Device Key เดิม` ว่าง ระบบจึงจะสร้างคีย์ใหม่ให้

ถ้าสำเร็จ Serial Monitor จะเห็น:

```text
POST status: 201
```

ถ้าหน้า setup แสดง `Device Key` เป็นตัวอักษรเพี้ยน ให้อัปโหลดโค้ดเวอร์ชันล่าสุดนี้ใหม่ ESP จะล้างค่า key ที่เสียใน EEPROM ให้ แล้วให้กรอก Device Key ใหม่จาก dashboard

## ต่อจอ LCD 16x2 I2C กับ ESP8266

จอ LCD ในรูปเป็น LCD 16x2 พร้อม I2C backpack ใช้แสดงค่า Temp/RH และสถานะส่งข้อมูล

ติดตั้ง Arduino library:

```text
LiquidCrystal I2C
```

การต่อสายกับ NodeMCU ESP8266:

```text
LCD GND -> GND
LCD VCC -> 3V3 หรือ VIN/5V ตามจอที่ใช้
LCD SDA -> D5
LCD SCL -> D6
```

ค่าเริ่มต้นในโค้ด:

```cpp
#define LCD_SDA_PIN D5
#define LCD_SCL_PIN D6
#define LCD_ADDRESS 0x27
```

ถ้าจอไม่ขึ้นแต่ไฟติด ให้ลองเปลี่ยน address เป็น:

```cpp
#define LCD_ADDRESS 0x3F
```

ข้อความที่จอจะแสดง:

```text
Temp: 23.4 C
RH:   55.2 %
```

หรือสถานะอื่น เช่น:

```text
Connecting WiFi
SETUP WIFI / 192.168.4.1
DHT read failed
POST -1
```

## วิธีเพิ่มผู้ใช้ให้แต่ละโรงพยาบาล

Login ด้วย `system_admin` แล้วทำตามนี้:

1. เลือกโรงพยาบาล
2. ไปที่ `จัดการโรงพยาบาล / ห้อง / อุปกรณ์ / ผู้ใช้`
3. กรอกชื่อ, email, password
4. เลือก role:

```text
hospital_admin = ผู้ดูแลของโรงพยาบาลนั้น เพิ่มห้อง/อุปกรณ์/user ใน รพ. ตัวเองได้
staff          = ดู dashboard และ export รายงานของ รพ. ตัวเอง
auditor        = ดูข้อมูลและรายงานของ รพ. ตัวเอง
```

ผู้ใช้ที่ไม่ใช่ `system_admin` จะเห็นเฉพาะโรงพยาบาลของตัวเองเท่านั้น และ API รายงาน `/api/reports/monthly.csv` จะ export เฉพาะข้อมูลที่ user นั้นมีสิทธิ์

## Health Check

```text
/api/health
```

## Blynk IoT สำหรับ ESP

ระบบยังส่งข้อมูลเข้าเว็บ SaaS เหมือนเดิม และสามารถส่งค่าไป Blynk เพิ่มได้

1. ใน Arduino IDE ติดตั้ง library:

```text
Blynk
```

2. ในไฟล์ `esp8266_dht_monitor.ino` เปลี่ยน:

```cpp
#define USE_BLYNK 0
```

เป็น:

```cpp
#define USE_BLYNK 1
```

3. ใน Blynk Console สร้าง Device แล้วคัดลอก `Auth Token`

4. เข้า setup ของ ESP แล้วกรอก:

```text
Enable Blynk IoT = เปิด
Blynk Auth Token = token ของ device ใน Blynk
```

5. Datastream / Virtual Pin ที่ใช้:

```text
V0 = Temperature (°C)
V1 = Relative Humidity (%)
V2 = Status
```

ถ้าไม่ได้ใช้ Blynk ให้คง `USE_BLYNK 0` ไว้ โค้ดจะ compile ได้โดยไม่ต้องติดตั้ง Blynk library

## MQTT Broker บน Coolify

โปรเจกต์นี้มี Mosquitto MQTT broker ใน `docker-compose.yml` แล้ว

### Environment Variables ใน Coolify

ตั้งค่าใน Coolify > Environment Variables:

```text
MQTT_USERNAME=sterile_iot
MQTT_PASSWORD=ตั้งรหัสผ่านใหม่ที่เดายาก
```

อย่าใช้ค่า default `change-this-mqtt-password` ใน production

### Ports

ต้องเปิด port ที่ server/firewall:

```text
1883 = MQTT สำหรับ ESP
9001 = MQTT over WebSocket สำหรับ browser/tool อื่น
```

### MQTT Connection

```text
Host: iot.phoubon.in.th
Port: 1883
Username: sterile_iot
Password: ค่าจาก MQTT_PASSWORD
```

### Topic ที่แนะนำ

```text
hospitals/{hospitalId}/rooms/{roomId}/devices/{deviceId}/readings
```

ตัวอย่าง payload:

```json
{
  "deviceKey": "dev_xxx",
  "temperature": 24.1,
  "humidity": 41.8
}
```

`server.js` subscribe topic นี้แล้ว และจะบันทึกข้อมูลเข้า database เหมือน HTTP POST

### เปิด MQTT ใน ESP

ใน Arduino IDE ติดตั้ง library:

```text
PubSubClient
```

ในไฟล์ `esp8266_dht_monitor.ino` เปลี่ยน:

```cpp
#define USE_MQTT 0
```

เป็น:

```cpp
#define USE_MQTT 1
```

แล้วอัปโหลดเข้า ESP ใหม่ จากนั้นเข้า setup page ของ ESP แล้วกรอก:

```text
Enable MQTT = เปิด
MQTT Host = iot.phoubon.in.th
MQTT Port = 1883
MQTT Username = sterile_iot
MQTT Password = ค่าจาก MQTT_PASSWORD ใน Coolify
MQTT Topic = hospitals/{hospitalId}/rooms/{roomId}/devices/{deviceId}/readings
```

เมื่อเปิด MQTT แล้ว ESP จะใช้ MQTT เป็นทางหลัก ถ้า MQTT ส่งไม่สำเร็จจะ fallback ไป HTTP เดิม เพื่อไม่ให้ข้อมูลในรายงานซ้ำ

## กันข้อมูลหายหลัง restart/redeploy บน Coolify

ระบบเก็บข้อมูลไว้ที่ไฟล์:

```text
/app/data/saas-db.json
```

ถ้า deploy แบบ Dockerfile ใน Coolify ต้องเพิ่ม Storage เอง:

```text
Type: Volume Mount
Source: sterile-room-monitor-data
Destination: /app/data
```

ถ้าไม่ได้ mount `/app/data` ข้อมูลจะอยู่ใน container ชั่วคราว และจะหายเมื่อ container ถูก recreate/redeploy

ตรวจสอบ path ที่ระบบใช้อยู่ได้ที่:

```text
https://iot.phoubon.in.th/api/health
```

ค่าที่ถูกต้องควรเห็นประมาณนี้:

```json
{
  "dataDir": "/app/data",
  "dbFile": "/app/data/saas-db.json",
  "dbFileExists": true
}
```
