export default async function handler(req, res) {
  // السماح فقط بـ POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // إعداد Google APIs
    const auth = new google.auth.GoogleAuth({
      credentials: GOOGLE_CREDENTIALS,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // تحليل النموذج والملفات
    const form = new IncomingForm({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 1024 * 1024 * 1024, // 1GB
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    // التحقق من الحقول المطلوبة
    const requiredFields = [
      'cust_name', 'contact_name', 'phone', 'city', 'district', 
      'building_no', 'street', 'postal', 'extra_no', 'cr_no', 'vat_no'
    ];
    
    for (const field of requiredFields) {
      if (!fields[field] || fields[field][0].trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: `الحقل ${field} مطلوب` 
        });
      }
    }

    // التحقق من رقم الجوال
    const phone = fields.phone[0];
    if (!/^05[0-9]{8}$/.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام' 
      });
    }

    // التحقق من الملف المرفوع
    if (!files.cr_vat_file) {
      return res.status(400).json({ 
        success: false, 
        message: 'يجب رفع ملف السجل التجاري والرقم الضريبي' 
      });
    }

    const file = files.cr_vat_file[0];
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/heic'];
    
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ 
        success: false, 
        message: 'نوع الملف غير مسموح. يجب أن يكون PDF أو صورة' 
      });
    }

    // رفع الملف إلى Google Drive
    const fileStream = require('fs').createReadStream(file.filepath);
    const customerId = `CUST_${Date.now()}`;
    const fileName = `${customerId}_${file.originalFilename}`;

    const driveResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: file.mimetype,
        body: fileStream
      }
    });

    // جعل الملف قابل للعرض
    await drive.permissions.create({
      fileId: driveResponse.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    const fileUrl = `https://drive.google.com/file/d/${driveResponse.data.id}/view`;

    // تحضير البيانات للحفظ في Google Sheets
    const rowData = [
      customerId,                           // ID
      fields.cust_name[0],                 // اسم العميل
      fields.contact_name[0],              // مسؤول الاتصال
      fields.phone[0],                     // رقم الجوال
      fields.email?.[0] || '',             // البريد الإلكتروني
      fields.city[0],                      // المدينة
      fields.district[0],                  // الحي
      fields.building_no[0],               // رقم المبنى
      fields.street[0],                    // اسم الشارع
      fields.postal[0],                    // الرمز البريدي
      fields.extra_no[0],                  // الرقم الإضافي
      fields.maps_url?.[0] || '',          // رابط الموقع
      fields.cr_no[0],                     // رقم السجل التجاري
      fields.vat_no[0],                    // الرقم الضريبي
      fileUrl,                             // رابط الملف
      fields.agent?.[0] || '',             // كود المندوب
      new Date().toLocaleString('ar-SA', { // تاريخ التسجيل
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    ];

    // إضافة البيانات إلى Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A:Q',
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowData]
      }
    });

    // حذف الملف المؤقت
    await fs.unlink(file.filepath);

    return res.status(200).json({
      success: true,
      message: 'تم تسجيل العميل بنجاح',
      customer_id: customerId,
      file_url: fileUrl
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ في الخادم. يرجى المحاولة مرة أخرى.',
      error: error.message
    });
  }
}
