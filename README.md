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
- แจ้งเตือนในเว็บและส่ง MOPH Notify เมื่อ Temp/RH ผิดเกณฑ์
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
MOPH_NOTIFY_BASE_URL=https://morpromt2f.moph.go.th
ALERT_COOLDOWN_MINUTES=30
MQTT_ENABLED=false
```

9. Deploy

การ deploy แบบ Dockerfile ไม่มี service ชื่อ `mqtt-broker` ให้ตั้ง `MQTT_ENABLED=false`
จนกว่าจะสร้าง MQTT Broker เป็น Resource แยกและเปลี่ยน `MQTT_URL` เป็น hostname ของ Broker
ที่ Application ติดต่อได้ ส่วน `docker-compose.yml` ของโครงการเปิด MQTT ไว้เพราะสร้าง Broker
มาพร้อมกันอยู่แล้ว

## ระบบแจ้งเตือน MOPH Notify แยกตามโรงพยาบาล

เมื่อ Temp/RH ผิดเกณฑ์ ระบบจะบันทึก alert และส่ง Flex Message ผ่าน MOPH Notify ไปยัง
LINE OA หมอพร้อมของโรงพยาบาลนั้น โดยไม่ต้องใช้ LINE Channel Access Token หรือ LINE ID

ค่าที่ต้องกรอกในหน้า `MOPH Notify ของ รพ.`:

```text
MOPH Notify Base URL = https://morpromt2f.moph.go.th
Client Key = จากเมนูหน่วยบริการใน CMS MOPH Notify
Secret Key = จากเมนูหน่วยบริการใน CMS MOPH Notify
แจ้งซ้ำทุกกี่นาที = 30 (ปรับได้)
```

ระบบเรียก API ตามเอกสาร:

```text
POST https://morpromt2f.moph.go.th/api/notify/send
Content-Type: application/json
client-key: CLIENT_KEY_ของโรงพยาบาล
secret-key: SECRET_KEY_ของโรงพยาบาล
```

Body มีรูปแบบ:

```json
{
  "messages": [
    {
      "type": "flex",
      "altText": "แจ้งเตือนอุณหภูมิและความชื้น",
      "contents": {}
    }
  ]
}
```

แต่ละโรงพยาบาลเก็บ Client Key และ Secret Key แยกกัน ผู้ดูแลโรงพยาบาลเห็นและแก้ไขได้
เฉพาะค่าของโรงพยาบาลตนเอง หลังบันทึกให้กด `ทดสอบ MOPH Notify` หนึ่งครั้ง

ถ้าต้องการทดสอบด้วย API ให้ login ด้วย `system_admin` หรือ `hospital_admin` แล้วเรียก:

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

ระบบใช้ SQLite และเก็บฐานข้อมูลไว้ที่:

```text
/app/data/saas.db
```

เมื่อ deploy เวอร์ชันนี้ครั้งแรก ถ้ามีไฟล์เดิม `/app/data/saas-db.json` ระบบจะนำข้อมูล
โรงพยาบาล ห้อง อุปกรณ์ ผู้ใช้ readings และ alerts เข้า SQLite ให้อัตโนมัติ หากไฟล์ JSON
เคยถูกเขียนต่อกันจนเปิดไม่ได้ ระบบจะกู้จาก JSON ก้อนล่าสุดที่สมบูรณ์ก่อนนำเข้า ไฟล์เดิมจะ
ยังคงอยู่เพื่อใช้เป็นสำเนาสำรองและจะไม่ถูกลบ

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
  "storage": "sqlite",
  "dataDir": "/app/data",
  "dbFile": "/app/data/saas.db",
  "dbFileExists": true
}
```

หลังย้ายข้อมูลสำเร็จ Logs ของ Coolify จะแสดง `SQLite initialized from: legacy-json`
ครั้งแรก และแสดง `SQLite initialized from: sqlite` ในการเปิดระบบครั้งถัดไป

ก่อนสำรองฐานข้อมูลด้วยการคัดลอกไฟล์ ให้หยุด application ชั่วคราว แล้วสำรองไฟล์
`/app/data/saas.db` จาก Volume เพื่อให้ได้ข้อมูลครบทั้ง transaction
