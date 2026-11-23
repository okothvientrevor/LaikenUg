-- Sample shipments so the dashboard isn't empty on first run.
-- They use the LKL-DEMO-* prefix; delete them once real shipments are in:
--   DELETE FROM shipments WHERE tracking_no LIKE 'LKL-DEMO-%';

INSERT INTO shipments (tracking_no, client_name, client_phone, mode, origin, destination, port, border,
                       container_no, bl_awb_no, cargo_desc, packages, weight_kg, status, current_location,
                       eta, free_days_end, assigned_to)
VALUES
  ('LKL-DEMO-001', 'Sample Client A', '0700000001', 'sea', 'Guangzhou, China', 'Kampala, Uganda', 'Mombasa', 'Malaba',
   'MSCU1234567', 'MEDU9876543', 'Building materials (tiles)', 420, 18500, 'customs_clearance', 'Mombasa Port',
   current_date + 9, current_date + 2, 'Clearing desk'),
  ('LKL-DEMO-002', 'Sample Client B', '0700000002', 'sea', 'Jebel Ali, Dubai', 'Kampala, Uganda', 'Mombasa', 'Busia',
   'TGHU7654321', 'MAEU5550001', 'Electronics & accessories', 160, 6200, 'in_transit_road', 'Nakuru, Kenya',
   current_date + 3, NULL, 'Road desk'),
  ('LKL-DEMO-003', 'Sample Client C', '0700000003', 'air', 'Dubai (DXB)', 'Kampala, Uganda', 'Entebbe', NULL,
   NULL, '176-12345675', 'Phone spares', 12, 340, 'delivered', 'Kampala',
   current_date - 2, NULL, 'Air desk'),
  ('LKL-DEMO-004', 'Sample Client D', '0700000004', 'sea', 'Shanghai, China', 'Mbarara, Uganda', 'Dar es Salaam', 'Mutukula',
   'CMAU2468101', 'CMDU3332221', 'Solar panels', 300, 9800, 'at_sea', 'Indian Ocean',
   current_date + 21, NULL, 'Clearing desk'),
  ('LKL-DEMO-005', 'Sample Client E', '0700000005', 'road', 'Mombasa, Kenya', 'Kampala, Uganda', 'Mombasa', 'Malaba',
   'OOLU1357913', 'OOLU0001112', 'Used motor vehicle', 1, 1450, 'at_border', 'Malaba Border',
   current_date + 1, NULL, 'Road desk')
ON CONFLICT (tracking_no) DO NOTHING;

INSERT INTO shipment_events (shipment_id, status, location, note, is_public, created_by, created_at)
SELECT s.id, e.status, e.location, e.note, e.is_public, 'seed', now() - e.ago
FROM shipments s
JOIN (VALUES
  ('LKL-DEMO-001', 'booked',            'Guangzhou, China', 'Booking confirmed with shipping line', true,  interval '30 days'),
  ('LKL-DEMO-001', 'loaded_origin',     'Nansha Port',      'Container loaded on vessel',           true,  interval '27 days'),
  ('LKL-DEMO-001', 'at_sea',            'Indian Ocean',     'Vessel sailing to Mombasa',            true,  interval '26 days'),
  ('LKL-DEMO-001', 'arrived_port',      'Mombasa Port',     'Vessel berthed, container discharged', true,  interval '4 days'),
  ('LKL-DEMO-001', 'customs_clearance', 'Mombasa Port',     'Entry lodged on URA ASYCUDA',          true,  interval '1 day'),
  ('LKL-DEMO-001', 'customs_clearance', 'Mombasa Port',     'Awaiting PVoC certificate copy',       false, interval '5 hours'),
  ('LKL-DEMO-002', 'booked',            'Jebel Ali',        'Booking confirmed',                    true,  interval '25 days'),
  ('LKL-DEMO-002', 'at_sea',            'Indian Ocean',     'Sailing',                              true,  interval '22 days'),
  ('LKL-DEMO-002', 'arrived_port',      'Mombasa Port',     'Discharged',                           true,  interval '8 days'),
  ('LKL-DEMO-002', 'released',          'Mombasa Port',     'Release order issued',                 true,  interval '3 days'),
  ('LKL-DEMO-002', 'in_transit_road',   'Nakuru, Kenya',    'Truck UBK 123X on the Northern Corridor', true, interval '6 hours'),
  ('LKL-DEMO-003', 'in_flight',         'Dubai (DXB)',      'Departed on flight',                   true,  interval '6 days'),
  ('LKL-DEMO-003', 'customs_clearance', 'Entebbe Airport',  'Cleared by URA',                       true,  interval '4 days'),
  ('LKL-DEMO-003', 'delivered',         'Kampala',          'Delivered and signed for',             true,  interval '2 days'),
  ('LKL-DEMO-004', 'booked',            'Shanghai',         'Booking confirmed',                    true,  interval '10 days'),
  ('LKL-DEMO-004', 'at_sea',            'Indian Ocean',     'Vessel en route to Dar es Salaam',     true,  interval '7 days'),
  ('LKL-DEMO-005', 'released',          'Mombasa Port',     'Vehicle released',                     true,  interval '4 days'),
  ('LKL-DEMO-005', 'in_transit_road',   'Eldoret, Kenya',   'On car carrier',                       true,  interval '2 days'),
  ('LKL-DEMO-005', 'at_border',         'Malaba Border',    'Queued at Malaba OSBP',                true,  interval '3 hours')
) AS e(tracking_no, status, location, note, is_public, ago) ON e.tracking_no = s.tracking_no
WHERE NOT EXISTS (SELECT 1 FROM shipment_events x WHERE x.shipment_id = s.id);
