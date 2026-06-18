# Sterile Storage Room IoT Monitor

เว็บแอปสำหรับรับข้อมูลอุณหภูมิและความชื้นจาก ESP8266 แล้วแสดงเป็นตารางรายเดือนตามแบบฟอร์มห้องเก็บเครื่องมือปราศจากเชื้อ

## เปิดใช้งานในเครื่อง

```powershell
cd "C:\Users\DELL\Documents\Codex\2026-06-17\c-users-dell-downloads-chatgpt-image\outputs\iot-sterile-room-monitor"
npm start
```

เปิดเว็บ:

```text
http://localhost:3000
```

## Deploy บน Coolify

โปรเจกต์นี้เตรียม `Dockerfile` และ `docker-compose.yml` ไว้แล้ว

### วิธีที่แนะนำ: Deploy จาก Git Repository

1. อัปโหลดโฟลเดอร์ `iot-sterile-room-monitor` ขึ้น GitHub หรือ Git server
2. เข้า Coolify ที่ `https://coolify.phoubon.in.th`
3. สร้าง Project ใหม่
4. เลือก Add Resource > Application
5. เลือก Git Repository ของโปรเจกต์นี้
6. เลือก Build Pack เป็น `Dockerfile`
7. ตั้งค่า Port เป็น `3000`
8. ตั้ง Domain เป็นชื่อที่ต้องการ เช่น

```text
sterile.phoubon.in.th
```

หรือถ้าจะใช้ path ใต้โดเมนเดิม:

```text
coolify.phoubon.in.th
```

ให้ตั้งตาม reverse proxy/domain ที่คุณมีสิทธิ์ใช้งานใน Coolify

9. เพิ่ม Persistent Storage / Volume:

```text
/app/data
```

เพื่อให้ไฟล์ข้อมูล `readings.json` ไม่หายตอน redeploy

10. Deploy

## Environment Variables

```text
PORT=3000
DATA_DIR=/app/data
SEED_DEMO_DATA=false
```

## API ที่ ESP ต้องส่งข้อมูล

หลัง deploy แล้วให้แก้ในโค้ด ESP:

```cpp
const char* SERVER_URL = "https://YOUR-DOMAIN/api/readings";
```

ตัวอย่าง:

```cpp
const char* SERVER_URL = "https://sterile.phoubon.in.th/api/readings";
```

ข้อมูลที่ส่ง:

```json
{
  "deviceId": "ESP-STERILE-ROOM-01",
  "temperature": 23.4,
  "humidity": 51.2
}
```

ถ้าส่งสำเร็จ Serial Monitor จะขึ้น:

```text
POST status: 201
```

## Health Check

```text
https://YOUR-DOMAIN/api/health
```

ควรตอบกลับ:

```json
{"ok":true,"service":"iot-sterile-room-monitor"}
```
