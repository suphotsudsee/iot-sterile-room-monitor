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

ถ้าสำเร็จ Serial Monitor จะเห็น:

```text
POST status: 201
```

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
