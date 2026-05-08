export interface DriverRow {
  id: number;
  name: string;
  mobile_number: string | null;
  transporter: string | null;
  id_license_expiration_date: string | null;
  driver_license_expiration_date: string | null;
  is_approved: boolean;
  fetched_at: string;
}
