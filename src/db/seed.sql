BEGIN;

INSERT INTO specialties (id, name, description, active) VALUES
  (1, 'General Medicine', 'Primary care for common illnesses, preventive checks, and chronic disease follow-up.', true),
  (2, 'Dermatology', 'Diagnosis and treatment for skin, hair, nail, and allergy concerns.', true),
  (3, 'Pediatrics', 'Child health services from newborn care through adolescent medicine.', true),
  (4, 'Cardiology', 'Heart health screening, ECG review, hypertension, and cardiovascular follow-up.', true),
  (5, 'Obstetrics and Gynecology', 'Women''s health, pregnancy care, contraception, and gynecologic consultation.', true),
  (6, 'Orthopedics', 'Bone, joint, muscle, sports injury, and mobility care.', true)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  active = excluded.active;

INSERT INTO doctors (id, full_name, specialty_id, active, photo_url, email, phone, bio) VALUES
  (1, 'Dr. Amanda Putri, Sp.PD', 1, true, 'https://cdn.clinic.test/doctors/amanda-putri.jpg', 'amanda.putri@sehatprima.test', '+62 21 5550 1101', 'Internist focused on diabetes, hypertension, and preventive adult care.'),
  (2, 'Dr. Budi Santoso', 1, true, 'https://cdn.clinic.test/doctors/budi-santoso.jpg', 'budi.santoso@sehatprima.test', '+62 21 5550 1102', 'Family physician with experience in urgent visits and long-term wellness plans.'),
  (3, 'Dr. Citra Lestari, Sp.KK', 2, true, 'https://cdn.clinic.test/doctors/citra-lestari.jpg', 'citra.lestari@sehatprima.test', '+62 21 5550 1201', 'Dermatologist treating acne, eczema, infections, and cosmetic skin concerns.'),
  (4, 'Dr. Dewi Anggraini, Sp.A', 3, true, 'https://cdn.clinic.test/doctors/dewi-anggraini.jpg', 'dewi.anggraini@sehatprima.test', '+62 21 5550 1301', 'Pediatrician supporting growth monitoring, vaccination, and childhood illness care.'),
  (5, 'Dr. Eko Prasetyo, Sp.JP', 4, true, 'https://cdn.clinic.test/doctors/eko-prasetyo.jpg', 'eko.prasetyo@sehatprima.test', '+62 21 5550 1401', 'Cardiologist focused on hypertension, chest pain evaluation, and heart risk reduction.'),
  (6, 'Dr. Farah Nabila, Sp.OG', 5, true, 'https://cdn.clinic.test/doctors/farah-nabila.jpg', 'farah.nabila@sehatprima.test', '+62 21 5550 1501', 'Obstetrician and gynecologist providing antenatal care and women''s health consultation.'),
  (7, 'Dr. Guntur Wijaya, Sp.OT', 6, true, 'https://cdn.clinic.test/doctors/guntur-wijaya.jpg', 'guntur.wijaya@sehatprima.test', '+62 21 5550 1601', 'Orthopedic surgeon for sports injuries, back pain, and joint conditions.'),
  (8, 'Dr. Hana Maharani', 1, false, NULL, 'hana.maharani@sehatprima.test', '+62 21 5550 1103', 'General practitioner currently unavailable for online booking.')
ON CONFLICT (id) DO UPDATE SET
  full_name = excluded.full_name,
  specialty_id = excluded.specialty_id,
  active = excluded.active,
  photo_url = excluded.photo_url,
  email = excluded.email,
  phone = excluded.phone,
  bio = excluded.bio;

INSERT INTO doctor_schedule_rules (id, doctor_id, weekday, start_time, end_time, slot_minutes) VALUES
  (1, 1, 1, '09:00', '12:00', 30),
  (2, 1, 2, '09:00', '12:00', 30),
  (3, 1, 3, '09:00', '12:00', 30),
  (4, 1, 4, '09:00', '12:00', 30),
  (5, 1, 5, '09:00', '12:00', 30),
  (6, 2, 1, '13:00', '17:00', 30),
  (7, 2, 3, '13:00', '17:00', 30),
  (8, 2, 5, '13:00', '17:00', 30),
  (9, 3, 2, '10:00', '14:00', 30),
  (10, 3, 4, '10:00', '14:00', 30),
  (11, 4, 1, '08:00', '12:00', 30),
  (12, 4, 2, '08:00', '12:00', 30),
  (13, 4, 5, '08:00', '12:00', 30),
  (14, 5, 3, '14:00', '18:00', 60),
  (15, 5, 6, '09:00', '13:00', 60),
  (16, 6, 1, '10:00', '13:00', 30),
  (17, 6, 4, '15:00', '18:00', 30),
  (18, 7, 2, '14:00', '18:00', 45),
  (19, 7, 5, '09:00', '12:00', 45)
ON CONFLICT (id) DO UPDATE SET
  doctor_id = excluded.doctor_id,
  weekday = excluded.weekday,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  slot_minutes = excluded.slot_minutes;

INSERT INTO doctor_schedule_exceptions (id, doctor_id, date, start_time, end_time, reason) VALUES
  (1, 1, '2026-07-13', '10:30', '11:30', 'Clinical case conference'),
  (2, 3, '2026-07-14', NULL, NULL, 'Dermatology workshop'),
  (3, 5, '2026-07-18', '11:00', '13:00', 'Hospital ward round'),
  (4, 6, '2026-07-16', '16:00', '18:00', 'Emergency surgery standby')
ON CONFLICT (id) DO UPDATE SET
  doctor_id = excluded.doctor_id,
  date = excluded.date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  reason = excluded.reason;

INSERT INTO patients (id, full_name, phone, created_at) VALUES
  (1, 'Rina Prameswari', '6281211122233', '2026-07-01 09:12:00'),
  (2, 'Michael Tan', '6281312345678', '2026-07-02 14:25:00'),
  (3, 'Siti Rahmawati', '6285211123344', '2026-07-03 10:40:00'),
  (4, 'Ahmad Fauzi', '6287710102020', '2026-07-04 16:18:00'),
  (5, 'Nadia Kartika', '6282212340099', '2026-07-05 11:03:00'),
  (6, 'Kevin Wijaya', '6285698765432', '2026-07-06 13:37:00')
ON CONFLICT (id) DO UPDATE SET
  full_name = excluded.full_name,
  phone = excluded.phone,
  created_at = excluded.created_at;

INSERT INTO bookings (id, reference, patient_id, doctor_id, date, start_time, end_time, status, created_at, cancelled_at) VALUES
  (1, 'BK-20260713-001', 1, 1, '2026-07-13', '09:00', '09:30', 'active', '2026-07-10 08:05:00', NULL),
  (2, 'BK-20260714-002', 2, 3, '2026-07-14', '10:00', '10:30', 'cancelled', '2026-07-09 15:22:00', '2026-07-10 09:10:00'),
  (3, 'BK-20260715-003', 3, 5, '2026-07-15', '14:00', '15:00', 'active', '2026-07-10 10:15:00', NULL),
  (4, 'BK-20260717-004', 4, 2, '2026-07-17', '13:00', '13:30', 'active', '2026-07-10 11:30:00', NULL),
  (5, 'BK-20260720-005', 5, 6, '2026-07-20', '10:30', '11:00', 'active', '2026-07-10 12:08:00', NULL),
  (6, 'BK-20260721-006', 6, 7, '2026-07-21', '14:45', '15:30', 'active', '2026-07-10 13:50:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  reference = excluded.reference,
  patient_id = excluded.patient_id,
  doctor_id = excluded.doctor_id,
  date = excluded.date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  status = excluded.status,
  created_at = excluded.created_at,
  cancelled_at = excluded.cancelled_at;

INSERT INTO conversation_sessions (id, stage, state_json, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'booking_complete', '{"specialtyId":1,"specialtyName":"General Medicine","doctorId":1,"doctorName":"Dr. Amanda Putri, Sp.PD","date":"2026-07-13","slotStart":"09:00","slotEnd":"09:30","patientName":"Rina Prameswari","patientPhone":"6281211122233","bookingReference":"BK-20260713-001"}', '2026-07-10 08:00:00', '2026-07-10 08:05:00'),
  ('22222222-2222-4222-8222-222222222222', 'cancelled', '{"specialtyId":2,"specialtyName":"Dermatology","doctorId":3,"doctorName":"Dr. Citra Lestari, Sp.KK","date":"2026-07-14"}', '2026-07-09 15:15:00', '2026-07-10 09:10:00'),
  ('33333333-3333-4333-8333-333333333333', 'collect_patient_phone', '{"specialtyId":3,"specialtyName":"Pediatrics","doctorId":4,"doctorName":"Dr. Dewi Anggraini, Sp.A","date":"2026-07-17","slotStart":"08:30","slotEnd":"09:00","patientName":"Maya Lestari"}', '2026-07-10 16:45:00', '2026-07-10 16:50:00')
ON CONFLICT (id) DO UPDATE SET
  stage = excluded.stage,
  state_json = excluded.state_json,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

INSERT INTO conversation_messages (id, session_id, role, content, created_at) VALUES
  (1, '11111111-1111-4111-8111-111111111111', 'assistant', 'Hello! Welcome to the clinic. I can help you book an appointment.\n\nWhich specialty do you need?', '2026-07-10 08:00:00'),
  (2, '11111111-1111-4111-8111-111111111111', 'user', 'General Medicine', '2026-07-10 08:01:00'),
  (3, '11111111-1111-4111-8111-111111111111', 'assistant', 'Here are our General Medicine doctors. Who would you like to see?', '2026-07-10 08:01:05'),
  (4, '11111111-1111-4111-8111-111111111111', 'user', 'Dr. Amanda Putri', '2026-07-10 08:02:00'),
  (5, '11111111-1111-4111-8111-111111111111', 'assistant', 'Your appointment is booked! Reference: BK-20260713-001\nDr. Amanda Putri, Sp.PD on 2026-07-13 at 09:00.\nKeep this reference for any changes. Send any message to book another appointment.', '2026-07-10 08:05:00'),
  (6, '22222222-2222-4222-8222-222222222222', 'user', 'cancel', '2026-07-10 09:09:55'),
  (7, '22222222-2222-4222-8222-222222222222', 'assistant', 'No problem, I''ve cancelled this booking flow. Send any message to start again.', '2026-07-10 09:10:00'),
  (8, '33333333-3333-4333-8333-333333333333', 'assistant', 'May I have your full name?', '2026-07-10 16:49:00'),
  (9, '33333333-3333-4333-8333-333333333333', 'user', 'Maya Lestari', '2026-07-10 16:49:30'),
  (10, '33333333-3333-4333-8333-333333333333', 'assistant', 'Thanks, Maya Lestari. What''s your phone number?', '2026-07-10 16:50:00')
ON CONFLICT (id) DO UPDATE SET
  session_id = excluded.session_id,
  role = excluded.role,
  content = excluded.content,
  created_at = excluded.created_at;

INSERT INTO audit_events (id, event_type, payload_json, created_at) VALUES
  (1, 'booking_created', '{"reference":"BK-20260713-001","doctorId":1,"patientId":1,"date":"2026-07-13","startTime":"09:00"}', '2026-07-10 08:05:01'),
  (2, 'booking_cancelled', '{"reference":"BK-20260714-002"}', '2026-07-10 09:10:01'),
  (3, 'booking_created', '{"reference":"BK-20260715-003","doctorId":5,"patientId":3,"date":"2026-07-15","startTime":"14:00"}', '2026-07-10 10:15:01'),
  (4, 'booking_failed', '{"doctorId":1,"date":"2026-07-13","startTime":"09:00","error":"Slot is no longer available"}', '2026-07-10 14:35:00')
ON CONFLICT (id) DO UPDATE SET
  event_type = excluded.event_type,
  payload_json = excluded.payload_json,
  created_at = excluded.created_at;

INSERT INTO clinic_settings (id, name, address, latitude, longitude, phone, email, permission_letter_url, emblem_url, extra_json, updated_at) VALUES
  (1, 'Klinik Sehat Prima', 'Jl. Hang Tuah Raya No. 27, Kebayoran Baru, Jakarta Selatan 12120', -6.241586, 106.799118, '+62 21 5550 1000', 'hello@sehatprima.test', 'https://cdn.clinic.test/legal/izin-operasional-sehat-prima.pdf', 'https://cdn.clinic.test/brand/sehat-prima-emblem.svg', '{"openingHours":"Monday-Saturday 08:00-18:00","whatsapp":"+628111000222","insurancePartners":["BPJS Kesehatan","Prudential","Allianz"],"parking":"Basement and street parking available"}', '2026-07-10 08:00:00')
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  phone = excluded.phone,
  email = excluded.email,
  permission_letter_url = excluded.permission_letter_url,
  emblem_url = excluded.emblem_url,
  extra_json = excluded.extra_json,
  updated_at = excluded.updated_at;

INSERT INTO theme_settings (id, primary_color, secondary_color, accent_color, logo_url, font_family, dark_mode, extra_json, updated_at) VALUES
  (1, '#0f766e', '#164e63', '#f59e0b', 'https://cdn.clinic.test/brand/sehat-prima-logo.svg', 'Inter', false, '{"radius":"14px","heroImage":"https://cdn.clinic.test/brand/clinic-lobby.jpg","supportBubble":"Need help choosing a doctor?"}', '2026-07-10 08:00:00')
ON CONFLICT (id) DO UPDATE SET
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  accent_color = excluded.accent_color,
  logo_url = excluded.logo_url,
  font_family = excluded.font_family,
  dark_mode = excluded.dark_mode,
  extra_json = excluded.extra_json,
  updated_at = excluded.updated_at;

INSERT INTO staff (id, full_name, role, email, phone, photo_url, active, created_at) VALUES
  (1, 'Maya Permata', 'receptionist', 'maya.permata@sehatprima.test', '+62 21 5550 1701', 'https://cdn.clinic.test/staff/maya-permata.jpg', true, '2026-06-20 09:00:00'),
  (2, 'Rizky Aditya', 'nurse', 'rizky.aditya@sehatprima.test', '+62 21 5550 1702', 'https://cdn.clinic.test/staff/rizky-aditya.jpg', true, '2026-06-20 09:10:00'),
  (3, 'Laras Salsabila', 'clinic_admin', 'laras.salsabila@sehatprima.test', '+62 21 5550 1703', 'https://cdn.clinic.test/staff/laras-salsabila.jpg', true, '2026-06-20 09:20:00'),
  (4, 'Dimas Prakoso', 'pharmacist', 'dimas.prakoso@sehatprima.test', '+62 21 5550 1704', NULL, true, '2026-06-20 09:30:00')
ON CONFLICT (id) DO UPDATE SET
  full_name = excluded.full_name,
  role = excluded.role,
  email = excluded.email,
  phone = excluded.phone,
  photo_url = excluded.photo_url,
  active = excluded.active,
  created_at = excluded.created_at;

INSERT INTO slot_presets (id, label, minutes, active) VALUES
  (1, 'Brief follow-up (15 min)', 15, true),
  (2, 'Standard consultation (30 min)', 30, true),
  (3, 'Extended consultation (45 min)', 45, true),
  (4, 'Specialist review (60 min)', 60, true)
ON CONFLICT (id) DO UPDATE SET
  label = excluded.label,
  minutes = excluded.minutes,
  active = excluded.active;

INSERT INTO shifts (id, name, start_time, end_time, active) VALUES
  (1, 'Morning Clinic', '08:00', '12:00', true),
  (2, 'Afternoon Clinic', '13:00', '17:00', true),
  (3, 'Evening Support', '17:00', '20:00', true)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  active = excluded.active;

INSERT INTO shift_assignments (id, shift_id, doctor_id, staff_id, date, created_at) VALUES
  (1, 1, 1, NULL, '2026-07-13', '2026-07-10 08:00:00'),
  (2, 2, 2, NULL, '2026-07-13', '2026-07-10 08:00:00'),
  (3, 1, NULL, 1, '2026-07-13', '2026-07-10 08:00:00'),
  (4, 1, NULL, 2, '2026-07-13', '2026-07-10 08:00:00'),
  (5, 1, 4, NULL, '2026-07-14', '2026-07-10 08:00:00'),
  (6, 2, 3, NULL, '2026-07-14', '2026-07-10 08:00:00'),
  (7, 2, NULL, 3, '2026-07-14', '2026-07-10 08:00:00'),
  (8, 3, NULL, 4, '2026-07-14', '2026-07-10 08:00:00'),
  (9, 2, 5, NULL, '2026-07-15', '2026-07-10 08:00:00'),
  (10, 1, 6, NULL, '2026-07-16', '2026-07-10 08:00:00')
ON CONFLICT (id) DO UPDATE SET
  shift_id = excluded.shift_id,
  doctor_id = excluded.doctor_id,
  staff_id = excluded.staff_id,
  date = excluded.date,
  created_at = excluded.created_at;

COMMIT;
