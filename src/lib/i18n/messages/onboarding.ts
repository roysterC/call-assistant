/**
 * Joining and setting up: the invite page, onboarding, the editors it shares
 * with Settings (hours, services, team), the sign-in help pages, team logins
 * and the emails. [English, Vietnamese].
 *
 * English that says "stylist" is put in the salon's own word ("nail
 * technician") by useT; the Vietnamese "thợ" fits every trade.
 */

export const onboarding = {
  // The flags that switch language, everywhere.
  "lang.switchTo": ["Switch to {name}", "Chuyển sang {name}"],
  "lang.current": ["Language: {name}", "Ngôn ngữ: {name}"],

  // Kinds of salon (business-types.ts).
  "type.hair": ["Hair salon", "Tiệm tóc"],
  "type.nails": ["Nail salon", "Tiệm nail"],
  "type.beauty": ["Beauty salon", "Tiệm làm đẹp"],
  "type.barber": ["Barbers", "Tiệm cắt tóc nam"],
  "type.main": ["What kind of salon is it?", "Tiệm của bạn thuộc loại nào?"],
  "type.also": ["Do you also offer…", "Tiệm còn làm thêm…"],
  "type.ownerHint": [
    "This tells the receptionist and chats what you do, and gives you a list of services to start from.",
    "Giúp lễ tân và tin nhắn tự động biết tiệm làm gì, và gợi ý sẵn danh sách dịch vụ để bắt đầu.",
  ],

  // Days, Monday first where listed.
  "day.0": ["Sunday", "Chủ nhật"],
  "day.1": ["Monday", "Thứ hai"],
  "day.2": ["Tuesday", "Thứ ba"],
  "day.3": ["Wednesday", "Thứ tư"],
  "day.4": ["Thursday", "Thứ năm"],
  "day.5": ["Friday", "Thứ sáu"],
  "day.6": ["Saturday", "Thứ bảy"],
  "dayShort.0": ["Sun", "CN"],
  "dayShort.1": ["Mon", "T2"],
  "dayShort.2": ["Tue", "T3"],
  "dayShort.3": ["Wed", "T4"],
  "dayShort.4": ["Thu", "T5"],
  "dayShort.5": ["Fri", "T6"],
  "dayShort.6": ["Sat", "T7"],

  // Opening hours editor.
  "hours.open": ["Open", "Mở"],
  "hours.closed": ["Closed", "Đóng"],
  "hours.none": ["No appointments offered", "Không nhận lịch hẹn"],
  "hours.to": ["to", "đến"],
  "hours.openingTime": ["{day} opening time", "Giờ mở cửa {day}"],
  "hours.closingTime": ["{day} closing time", "Giờ đóng cửa {day}"],
  "hours.order": ["Closing time must be after opening", "Giờ đóng cửa phải sau giờ mở cửa"],
  "hours.lastSlot": [
    "An appointment has to finish before closing time, so the last slot of the day depends on how long the service takes.",
    "Lịch hẹn phải xong trước giờ đóng cửa, nên lượt cuối trong ngày tuỳ vào thời lượng dịch vụ.",
  ],

  // Services editor.
  "svc.empty": [
    "No services yet. Without at least one, the receptionist cannot check the diary: it has no way to know how long an appointment needs.",
    "Chưa có dịch vụ nào. Cần ít nhất một dịch vụ thì lễ tân mới kiểm tra được sổ hẹn, vì không biết một lịch hẹn cần bao lâu.",
  ],
  "svc.name": ["Service name", "Tên dịch vụ"],
  "svc.minutes": ["Duration in minutes", "Thời lượng (phút)"],
  "svc.min": ["min", "phút"],
  "svc.price": ["Price in pounds", "Giá (bảng Anh)"],
  "svc.patch": ["Patch test", "Cần thử dị ứng"],
  "svc.noPatch": ["No patch test", "Không cần thử dị ứng"],
  "svc.remove": ["Remove {name}", "Xoá {name}"],
  "svc.thisService": ["this service", "dịch vụ này"],
  "svc.add": ["Add service", "Thêm dịch vụ"],
  "svc.dueAfter": ["Due again after", "Hẹn lại sau"],
  "svc.weeks": ["weeks", "tuần"],
  "svc.as": ["as", "dưới tên"],
  "svc.same": ["the same", "giống vậy"],
  "svc.noRebook": ["(blank: no rebooking text)", "(để trống: không nhắn hẹn lại)"],
  "svc.weeksLabel": ["Weeks until {name} is due again", "Số tuần đến khi {name} cần làm lại"],
  "svc.rebookAs": ["What {name} is rebooked as", "{name} được hẹn lại dưới tên gì"],
  "svc.typical": ["typical", "thông thường"],
  "svc.typicalTitle": ["Our typical time: check it's right for you", "Thời gian thông thường của chúng tôi: hãy kiểm tra"],
  "svc.help": [
    "Duration decides how much of the stylist's day is blocked. The price is a starting figure: the desk starts from it, and the receptionist and chats quote it as \"from\". What counts in the sales report is what was actually taken.",
    "Thời lượng quyết định một lịch hẹn chiếm bao nhiêu thời gian của thợ. Giá là giá khởi điểm: quầy bắt đầu từ giá này, lễ tân và tin nhắn báo là giá \"từ\". Báo cáo doanh thu tính theo số tiền thực thu.",
  ],
  "svc.patchHelp": [
    "Colour services should be marked as needing a patch test: that forces a 48-hour gap for anyone new.",
    "Dịch vụ nhuộm nên đánh dấu cần thử dị ứng: khách mới phải hẹn trước ít nhất 48 giờ.",
  ],

  // Which services one of the team does.
  "pick.all": ["All services", "Tất cả dịch vụ"],
  "pick.some": ["{n} of {total}", "{n}/{total}"],
  "pick.edit": ["Edit", "Sửa"],
  "pick.everything": ["None ticked, so they do everything.", "Không chọn gì nghĩa là làm tất cả."],
  "pick.choose": ["Choose services for {name}", "Chọn dịch vụ cho {name}"],
  "pick.title": ["Services {name} does", "Dịch vụ {name} làm"],
  "pick.thisStylist": ["this stylist", "thợ này"],
  "pick.search": ["Search services", "Tìm dịch vụ"],
  "pick.ticked": ["{n} ticked", "Đã chọn {n}"],
  "pick.tickAll": ["Tick all", "Chọn hết"],
  "pick.clear": ["Clear", "Bỏ chọn"],
  "pick.noMatch": ["No services match that.", "Không có dịch vụ nào khớp."],
  "pick.done": ["Done", "Xong"],
  "pick.two": ["{a} and {b}", "{a} và {b}"],
  "pick.more": ["{a} and {n} more", "{a} và {n} dịch vụ khác"],

  // Team editor.
  "sty.empty": ["No one added yet.", "Chưa có ai."],
  "sty.name": ["Name", "Tên"],
  "sty.nameLabel": ["Stylist name", "Tên thợ"],
  "sty.role": ["Role, e.g. {example}", "Vai trò, ví dụ: {example}"],
  "sty.roleLabel": ["Role", "Vai trò"],
  "sty.roleExample.hair": ["colour specialist", "chuyên nhuộm"],
  "sty.roleExample.nails": ["nail art", "vẽ móng"],
  "sty.roleExample.beauty": ["lash technician", "nối mi"],
  "sty.roleExample.barber": ["senior barber", "thợ chính"],
  "sty.remove": ["Remove {name}", "Xoá {name}"],
  "sty.stylist": ["stylist", "thợ"],
  "sty.upcomingOne": ["{name} has 1 booking still to come.", "{name} còn 1 lịch hẹn sắp tới."],
  "sty.upcomingMany": ["{name} has {n} bookings still to come.", "{name} còn {n} lịch hẹn sắp tới."],
  "sty.cantCheck": ["Couldn't check {name}'s bookings.", "Không kiểm tra được lịch hẹn của {name}."],
  "sty.stay": [
    "They stay in the diary under {name}'s name, to move to someone else, and come back if you add {name} again.",
    "Các lịch hẹn vẫn nằm trong sổ hẹn dưới tên {name} để chuyển cho người khác, và sẽ hiện lại nếu bạn thêm {name} lần nữa.",
  ],
  "sty.removeAnyway": ["Remove anyway", "Vẫn xoá"],
  "sty.keep": ["Keep", "Giữ lại"],
  "sty.calendar": ["Google calendar ID", "ID lịch Google"],
  "sty.notBookable": [
    "Not bookable until a calendar is shared with the service account.",
    "Chưa đặt lịch được cho đến khi lịch được chia sẻ với tài khoản dịch vụ.",
  ],
  "sty.days": ["Working days", "Ngày làm việc"],
  "sty.closedDay": ["The salon is closed this day", "Tiệm đóng cửa ngày này"],
  "sty.anyDay": ["None selected: available any day the salon is open.", "Chưa chọn: làm mọi ngày tiệm mở cửa."],
  "sty.services": ["Services they do", "Dịch vụ người này làm"],
  "sty.struck": [
    "Struck-through days are ones the salon is closed. Change them under Opening hours.",
    "Ngày bị gạch là ngày tiệm đóng cửa. Đổi trong Giờ mở cửa.",
  ],
  "sty.add": ["Add stylist", "Thêm thợ"],

  // Showing a password as it is typed.
  "pw.show": ["Show password", "Hiện mật khẩu"],
  "pw.hide": ["Hide password", "Ẩn mật khẩu"],
  "pw.hint": ["At least 8 characters.", "Ít nhất 8 ký tự."],
  "pw.short": ["Password must be at least 8 characters", "Mật khẩu phải có ít nhất 8 ký tự"],

  "common.offline": ["Couldn't reach Kikai. Check your connection and try again.", "Không kết nối được với Kikai. Kiểm tra mạng rồi thử lại."],
  "common.tooMany": ["Too many tries. Wait a few minutes and try again.", "Thử quá nhiều lần. Hãy đợi vài phút rồi thử lại."],

  // The invite link's page.
  "inv.welcome": ["Welcome to Kikai", "Chào mừng đến với Kikai"],
  "inv.intro": [
    "Make your login for {salon}. Next, we'll set up your salon together: it takes a few minutes.",
    "Tạo tài khoản đăng nhập cho {salon}. Sau đó chúng ta sẽ cùng thiết lập tiệm, chỉ mất vài phút.",
  ],
  "inv.introStaff": ["Make your login for {salon}.", "Tạo tài khoản đăng nhập cho {salon}."],
  "inv.email": ["Email", "Email"],
  "inv.name": ["Your name", "Tên của bạn"],
  "inv.password": ["Choose a password", "Chọn mật khẩu"],
  "inv.submit": ["Make my login", "Tạo tài khoản"],
  "inv.submitting": ["Making your login…", "Đang tạo tài khoản…"],
  "inv.broken": ["This link doesn't work", "Liên kết này không dùng được"],
  "inv.toSignIn": ["Go to sign in", "Đến trang đăng nhập"],
  "inv.renew": ["Send me a new link", "Gửi cho tôi liên kết mới"],
  "inv.renewed": [
    "We've sent a new link to the address this one was for. Check your inbox.",
    "Chúng tôi đã gửi liên kết mới đến địa chỉ email được mời. Hãy kiểm tra hộp thư.",
  ],
  "inv.failed": ["Couldn't make your login. Try again.", "Không tạo được tài khoản. Hãy thử lại."],
  "inv.err.invalid": ["This link is not valid.", "Liên kết không hợp lệ."],
  "inv.err.used": ["This link has already been used. Sign in instead.", "Liên kết đã được dùng. Hãy đăng nhập."],
  "inv.err.replaced": [
    "This link has been replaced or withdrawn. Use the latest email from Kikai.",
    "Liên kết này đã được thay thế hoặc huỷ. Hãy dùng email mới nhất từ Kikai.",
  ],
  "inv.err.expired": ["This link has expired.", "Liên kết đã hết hạn."],
  "inv.err.inactive": ["This salon is not active.", "Tiệm này hiện không hoạt động."],
  "inv.err.taken": ["That email already has a login. Sign in instead.", "Email này đã có tài khoản. Hãy đăng nhập."],
  "inv.err.name": ["Enter your name.", "Hãy nhập tên của bạn."],

  // Forgot password, new password, confirm email.
  "auth.forgotTitle": ["Forgot your password?", "Quên mật khẩu?"],
  "auth.forgotIntro": [
    "Enter the email you sign in with and we'll send you a link to choose a new one.",
    "Nhập email bạn dùng để đăng nhập, chúng tôi sẽ gửi liên kết để chọn mật khẩu mới.",
  ],
  "auth.enterEmail": ["Enter the email you sign in with.", "Hãy nhập email bạn dùng để đăng nhập."],
  "auth.send": ["Send me a link", "Gửi liên kết cho tôi"],
  "auth.back": ["Back to sign in", "Quay lại đăng nhập"],
  "auth.checkTitle": ["Check your email", "Kiểm tra email"],
  "auth.checkIntro": [
    "If {email} has a Kikai login, we've sent it a link to choose a new password. It works for an hour. Not there? Look in spam, or check the address.",
    "Nếu {email} có tài khoản Kikai, chúng tôi đã gửi liên kết để chọn mật khẩu mới. Liên kết dùng được trong một giờ. Không thấy? Hãy xem thư rác hoặc kiểm tra lại địa chỉ.",
  ],
  "auth.newTitle": ["Choose a new password", "Chọn mật khẩu mới"],
  "auth.newIntro": [
    "You'll be signed out everywhere else, and signed in here with it.",
    "Bạn sẽ được đăng xuất ở mọi nơi khác và đăng nhập ở đây bằng mật khẩu mới.",
  ],
  "auth.newPassword": ["New password", "Mật khẩu mới"],
  "auth.save": ["Save and sign in", "Lưu và đăng nhập"],
  "auth.saveFailed": ["Couldn't change your password. Try again.", "Không đổi được mật khẩu. Hãy thử lại."],
  "auth.sendNew": ["Send a new link", "Gửi liên kết mới"],
  "auth.err.invalid": ["This link is not valid.", "Liên kết không hợp lệ."],
  "auth.err.gone.reset": [
    "This link has expired or been used. Ask for a new one.",
    "Liên kết đã hết hạn hoặc đã được dùng. Hãy xin liên kết mới.",
  ],
  "auth.err.gone.verify": [
    "This link has expired or been used. Send a new one from your Account page.",
    "Liên kết đã hết hạn hoặc đã được dùng. Hãy gửi liên kết mới từ trang Tài khoản.",
  ],
  "auth.verifyTitle": ["Confirm your email", "Xác nhận email"],
  "auth.verifyIntro": ["Press the button to confirm this address is yours.", "Bấm nút để xác nhận đây là địa chỉ của bạn."],
  "auth.verifyButton": ["Confirm my email", "Xác nhận email"],
  "auth.verifiedTitle": ["Email confirmed", "Đã xác nhận email"],
  "auth.verifiedIntro": [
    "{email} is confirmed. If you ever forget your password, you can reset it from the sign-in page.",
    "{email} đã được xác nhận. Nếu quên mật khẩu, bạn có thể đặt lại từ trang đăng nhập.",
  ],
  "auth.goToKikai": ["Go to Kikai", "Vào Kikai"],

  // Onboarding.
  "onb.step": ["Step {n} of {total}", "Bước {n}/{total}"],
  "onb.signOut": ["Sign out", "Đăng xuất"],
  "onb.next": ["Next", "Tiếp"],
  "onb.skip": ["Skip", "Bỏ qua"],
  "onb.finish": ["Finish", "Hoàn tất"],
  "onb.salon.title": ["Your salon", "Tiệm của bạn"],
  "onb.salon.hint": ["Its name, as clients know it, and what you do.", "Tên tiệm mà khách biết, và tiệm làm gì."],
  "onb.hours.title": ["Opening hours", "Giờ mở cửa"],
  "onb.hours.hint": [
    "When clients can book. The receptionist tells callers these too.",
    "Khi nào khách có thể đặt lịch. Lễ tân cũng báo giờ này cho người gọi đến.",
  ],
  "onb.services.title": ["Your services", "Dịch vụ của bạn"],
  "onb.services.hint": ["What you offer and how long each takes.", "Tiệm làm những gì và mỗi dịch vụ mất bao lâu."],
  "onb.team.title": ["Your team", "Nhân viên"],
  "onb.team.hint": [
    "Who can be booked, the days they work and what they do.",
    "Ai có thể được đặt lịch, làm những ngày nào và làm dịch vụ gì.",
  ],
  "onb.about.title": ["About the salon", "Về tiệm"],
  "onb.about.hint": [
    "What the receptionist and chats can tell customers who ask. You can add to it later in Settings.",
    "Những gì lễ tân và tin nhắn có thể trả lời khi khách hỏi. Bạn có thể bổ sung sau trong Cài đặt.",
  ],
  "onb.ready.title": ["All set?", "Xong chưa?"],
  "onb.ready.hint": ["A last look before you start.", "Xem lại lần cuối trước khi bắt đầu."],
  "onb.salonName": ["Salon name", "Tên tiệm"],
  "onb.hoursPrompt": [
    "We've filled in a typical week: Monday to Saturday, 9:00am to 5:30pm. Change any day that's different for you.",
    "Chúng tôi đã điền sẵn một tuần thông thường: thứ hai đến thứ bảy, 9:00 đến 17:30. Hãy sửa những ngày khác với tiệm của bạn.",
  ],
  "onb.phone": ["Salon phone number", "Số điện thoại của tiệm"],
  "onb.phoneHint": [
    "Printed in booking texts, which clients can't reply to: it's how they reach you about a booking.",
    "In trong tin nhắn đặt lịch. Khách không trả lời được tin nhắn đó, nên đây là cách họ liên lạc với tiệm.",
  ],
  "onb.photoTitle": ["Got a price list?", "Bạn có bảng giá không?"],
  "onb.photoIntro": [
    "Take a photo of it, or add a PDF, and we'll fill in your services for you to check.",
    "Chụp ảnh hoặc thêm tệp PDF, chúng tôi sẽ điền dịch vụ để bạn kiểm tra.",
  ],
  "onb.orTypical": ["Or start from a typical list, and change it to suit you:", "Hoặc bắt đầu từ danh sách thông thường rồi sửa cho phù hợp:"],
  "onb.checkTimes": [
    "Check how long each takes: it decides how much of the diary a booking fills. Times marked \"typical\" are our guess.",
    "Hãy kiểm tra thời lượng từng dịch vụ: nó quyết định một lịch hẹn chiếm bao nhiêu thời gian trong sổ hẹn. Thời gian đánh dấu \"thông thường\" là ước tính của chúng tôi.",
  ],
  "onb.addMeQ": ["Do you take bookings yourself?", "Bạn có tự nhận khách không?"],
  "onb.addMe": ["Add me ({name})", "Thêm tôi ({name})"],
  "onb.aboutLabel": ["About the salon", "Về tiệm"],
  "onb.aboutPlaceholder": [
    "Where are you? 47 Bridge Street, next to the florist.\nParking? Six spaces behind the salon.\nCancellations: please give 24 hours' notice.\nGift vouchers: yes, any amount, from the desk.",
    "Tiệm ở đâu? 47 Bridge Street, cạnh tiệm hoa.\nĐỗ xe? Có 6 chỗ phía sau tiệm.\nHuỷ lịch: vui lòng báo trước 24 giờ.\nPhiếu quà tặng: có, mọi mệnh giá, mua tại quầy.",
  ],
  "onb.aboutHint": [
    "A question and its answer per line is plenty. Skip it for now if you like.",
    "Mỗi dòng một câu hỏi và câu trả lời là đủ. Có thể bỏ qua lúc này.",
  ],
  "onb.change": ["Change", "Sửa"],
  "onb.openDays": ["Open {n} days a week", "Mở cửa {n} ngày mỗi tuần"],
  "onb.openDay1": ["Open 1 day a week", "Mở cửa 1 ngày mỗi tuần"],
  "onb.closedAll": ["Closed every day", "Đóng cửa cả tuần"],
  "onb.servicesCount": ["{n} services", "{n} dịch vụ"],
  "onb.servicesCount1": ["1 service", "1 dịch vụ"],
  "onb.teamCount": ["{n} stylists", "{n} thợ"],
  "onb.teamCount1": ["1 stylist", "1 thợ"],
  "onb.lines": ["{n} lines", "{n} dòng"],
  "onb.nothingYet": ["Nothing yet", "Chưa có"],
  "onb.err.name": ["Enter your salon's name.", "Hãy nhập tên tiệm."],
  "onb.err.openDay": ["Open at least one day.", "Hãy mở cửa ít nhất một ngày."],
  "onb.err.service": ["Add at least one service.", "Hãy thêm ít nhất một dịch vụ."],
  "onb.err.duration": ["Give every service how long it takes.", "Hãy nhập thời lượng cho mọi dịch vụ."],
  "onb.err.team": ["Add at least one stylist.", "Hãy thêm ít nhất một thợ."],
  "onb.err.notReady": [
    "Your diary can't take bookings yet. Check your hours, services and team.",
    "Sổ hẹn chưa nhận lịch được. Hãy kiểm tra giờ mở cửa, dịch vụ và nhân viên.",
  ],
  "onb.err.save": ["Couldn't save. Try again.", "Không lưu được. Hãy thử lại."],
  "onb.loadFailed": [
    "Couldn't load your salon. Check your connection and reload the page.",
    "Không tải được thông tin tiệm. Kiểm tra mạng rồi tải lại trang.",
  ],
  "onb.staffTitle": ["Your salon is being set up", "Tiệm đang được thiết lập"],
  "onb.staffBody": [
    "The owner is putting in the salon's hours, services and team. You'll be able to use Kikai as soon as they finish.",
    "Chủ tiệm đang nhập giờ mở cửa, dịch vụ và nhân viên. Bạn sẽ dùng được Kikai ngay khi họ hoàn tất.",
  ],

  // After Finish.
  "done.title": ["You're set up", "Đã thiết lập xong"],
  "done.intro": ["{salon} is ready. Here's what to do next.", "{salon} đã sẵn sàng. Bước tiếp theo:"],
  "done.diary": ["Open your diary", "Mở sổ hẹn"],
  "done.diaryHint": ["See your week and add your first booking.", "Xem lịch tuần và thêm lịch hẹn đầu tiên."],
  "done.phone": ["Add Kikai to your phone", "Thêm Kikai vào điện thoại"],
  "done.phoneIos": ["iPhone: open Kikai in Safari, tap Share, then Add to Home Screen.", "iPhone: mở Kikai bằng Safari, bấm Chia sẻ, rồi Thêm vào MH chính."],
  "done.phoneAndroid": [
    "Android: open Kikai in Chrome, tap the ⋮ menu, then Add to Home screen.",
    "Android: mở Kikai bằng Chrome, bấm menu ⋮, rồi Thêm vào màn hình chính.",
  ],
  "done.team": ["Invite your team", "Mời nhân viên"],
  "done.teamHint": ["Give each of your team their own login, from Settings.", "Tạo tài khoản riêng cho từng nhân viên trong Cài đặt."],
  "done.line": ["Your phone line", "Đường dây điện thoại"],
  "done.lineHint": [
    "We'll be in touch to set up your phone line and receptionist.",
    "Chúng tôi sẽ liên hệ để thiết lập đường dây và lễ tân tự động.",
  ],

  // Team logins, in Settings.
  "logins.title": ["Team logins", "Tài khoản nhân viên"],
  "logins.intro": [
    "Everyone who signs in to {salon}. Staff can use the diary, clients and conversations, but not Settings.",
    "Những người đăng nhập vào {salon}. Nhân viên dùng được sổ hẹn, khách hàng và tin nhắn, nhưng không vào được Cài đặt.",
  ],
  "logins.owner": ["Owner", "Chủ tiệm"],
  "logins.staff": ["Staff", "Nhân viên"],
  "logins.you": ["You", "Bạn"],
  "logins.invite": ["Invite staff", "Mời nhân viên"],
  "logins.inviteTitle": ["Invite a member of staff", "Mời nhân viên"],
  "logins.inviteIntro": [
    "We'll email them a link to make their own login. They can use the diary, clients and conversations.",
    "Chúng tôi sẽ gửi email kèm liên kết để họ tự tạo tài khoản. Họ dùng được sổ hẹn, khách hàng và tin nhắn.",
  ],
  "logins.email": ["Their email", "Email của họ"],
  "logins.send": ["Send invitation", "Gửi lời mời"],
  "logins.sent": ["Invitation sent to {email}", "Đã gửi lời mời đến {email}"],
  "logins.pending": ["Invited: waiting for them to join", "Đã mời: đang chờ tham gia"],
  "logins.resend": ["Send again", "Gửi lại"],
  "logins.withdraw": ["Withdraw", "Huỷ lời mời"],
  "logins.remove": ["Remove", "Xoá"],
  "logins.removeQ": ["Remove {name}'s login?", "Xoá tài khoản của {name}?"],
  "logins.removeBody": [
    "They won't be able to sign in any more. Their bookings and notes stay.",
    "Họ sẽ không đăng nhập được nữa. Lịch hẹn và ghi chú vẫn được giữ.",
  ],
  "logins.noEmail": [
    "Email isn't set up yet, so invitations can't be sent. Ask Kikai to add your team.",
    "Chưa thiết lập email nên chưa gửi được lời mời. Hãy nhờ Kikai thêm nhân viên.",
  ],
  "logins.failed": ["Couldn't do that. Try again.", "Không thực hiện được. Hãy thử lại."],

  // Emails.
  "mail.copy": ["Or copy this into your browser:", "Hoặc sao chép liên kết này vào trình duyệt:"],
  "mail.invite.subject": ["You're invited to {salon} on Kikai", "Lời mời tham gia {salon} trên Kikai"],
  "mail.invite.reminderSubject": ["Your login for {salon} is waiting", "Tài khoản của bạn cho {salon} đang chờ"],
  "mail.invite.ownerHeading": ["Set up {salon} on Kikai", "Thiết lập {salon} trên Kikai"],
  "mail.invite.staffHeading": ["Join {salon} on Kikai", "Tham gia {salon} trên Kikai"],
  "mail.invite.ownerLine": [
    "Kikai is ready for your salon. Make your login, then we'll take you through your opening hours, services and team: it takes a few minutes.",
    "Kikai đã sẵn sàng cho tiệm của bạn. Hãy tạo tài khoản, sau đó chúng tôi sẽ hướng dẫn bạn nhập giờ mở cửa, dịch vụ và nhân viên, chỉ mất vài phút.",
  ],
  "mail.invite.staffLine": [
    "You've been given a login for {salon}'s diary on Kikai. Choose your password to start.",
    "Bạn được cấp tài khoản để dùng sổ hẹn của {salon} trên Kikai. Hãy chọn mật khẩu để bắt đầu.",
  ],
  "mail.invite.reminderLine": [
    "A reminder: your login for {salon} is waiting for you. Here's a fresh link.",
    "Nhắc nhở: tài khoản của bạn cho {salon} đang chờ. Đây là liên kết mới.",
  ],
  "mail.invite.button": ["Make my login", "Tạo tài khoản"],
  "mail.invite.footer": [
    "This link works once, for {days} days. If you weren't expecting it, you can ignore this email.",
    "Liên kết chỉ dùng được một lần, trong {days} ngày. Nếu bạn không mong đợi email này, hãy bỏ qua.",
  ],
  "mail.reset.subject": ["Reset your Kikai password", "Đặt lại mật khẩu Kikai"],
  "mail.reset.heading": ["Reset your password", "Đặt lại mật khẩu"],
  "mail.reset.line": [
    "Someone, hopefully you, asked to reset the password for your Kikai login.",
    "Có người (hy vọng là bạn) vừa yêu cầu đặt lại mật khẩu cho tài khoản Kikai của bạn.",
  ],
  "mail.reset.button": ["Choose a new password", "Chọn mật khẩu mới"],
  "mail.reset.footer": [
    "This link works once, for an hour. If you didn't ask, ignore this email: your password stays as it is.",
    "Liên kết chỉ dùng được một lần, trong một giờ. Nếu không phải bạn yêu cầu, hãy bỏ qua email này: mật khẩu vẫn giữ nguyên.",
  ],
  "mail.verify.subject": ["Confirm your email for Kikai", "Xác nhận email cho Kikai"],
  "mail.verify.heading": ["Confirm your email", "Xác nhận email"],
  "mail.verify.line": [
    "Confirm this is your address, so you can reset your password with it if you ever forget it.",
    "Xác nhận đây là địa chỉ của bạn để có thể đặt lại mật khẩu nếu quên.",
  ],
  "mail.verify.button": ["Confirm my email", "Xác nhận email"],
  "mail.verify.footer": [
    "This link works once, for a day. If you don't use Kikai, ignore this email.",
    "Liên kết chỉ dùng được một lần, trong một ngày. Nếu bạn không dùng Kikai, hãy bỏ qua email này.",
  ],
} as const;
