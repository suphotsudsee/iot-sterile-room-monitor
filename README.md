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
- แจ้งเตือนเมื่อ Temp/RH ผิดเกณฑ์
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
```

9. Deploy

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

## Health Check

```text
/api/health
```
