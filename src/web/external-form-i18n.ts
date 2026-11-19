import type { FormErrorCode } from "../private/external-form.ts";
import type { Language } from "./i18n.ts";

type Copy = Record<FormErrorCode | "summary", string>;
export const externalFormText: Record<Language, Copy> = {
  en: {
    summary: "Please correct the highlighted fields. Your entries are still here.",
    required: "Enter a value for this field.", tooLong: "Use 300 characters or fewer.",
    url: "Enter a complete http:// or https:// link, or leave it blank.",
    date: "Enter a valid calendar date.", time: "Enter a valid time.", dateRequired: "Add the date for this time, or clear the time.",
    zoneRequired: "Choose the organizer’s time zone for exact times, such as Africa/Casablanca, or clear the times.",
    zone: "Use a named time zone, such as Africa/Casablanca. Leave it blank if unknown and use dates only.",
    nonexistent: "This time does not exist during the clock change. Check the organizer’s schedule.",
    occurrence: "Choose the first or second occurrence under During a clock change.",
    endAfterStart: "The end must follow the start. Check the end date and time; leave them blank if unknown.",
    choice: "Choose one of the available options.",
  },
  fr: {
    summary: "Corrigez les champs indiqués. Les valeurs saisies sont conservées.",
    required: "Renseignez ce champ.", tooLong: "Utilisez 300 caractères au maximum.",
    url: "Saisissez un lien complet en http:// ou https://, ou laissez ce champ vide.",
    date: "Saisissez une date valide.", time: "Saisissez une heure valide.", dateRequired: "Ajoutez la date correspondant à cette heure, ou effacez l’heure.",
    zoneRequired: "Choisissez le fuseau horaire de l’organisateur pour les heures précises, par exemple Africa/Casablanca, ou effacez les heures.",
    zone: "Utilisez un fuseau nommé, par exemple Africa/Casablanca. S’il est inconnu, laissez-le vide et indiquez seulement les dates.",
    nonexistent: "Cette heure n’existe pas lors du changement d’heure. Vérifiez le programme officiel.",
    occurrence: "Choisissez la première ou la seconde occurrence dans Lors d’un changement d’heure.",
    endAfterStart: "La fin doit suivre le début. Vérifiez sa date et son heure ; laissez-les vides si elles sont inconnues.",
    choice: "Choisissez une des options proposées.",
  },
  ar: {
    summary: "صحّح الحقول المشار إليها. احتُفظ بالقيم التي أدخلتها.",
    required: "أدخل قيمة لهذا الحقل.", tooLong: "استخدم 300 حرف أو أقل.",
    url: "أدخل رابطاً كاملاً يبدأ بـ http:// أو https://، أو اترك الحقل فارغاً.",
    date: "أدخل تاريخاً صحيحاً.", time: "أدخل وقتاً صحيحاً.", dateRequired: "أضف تاريخ هذا الوقت، أو امسح الوقت.",
    zoneRequired: "اختر المنطقة الزمنية للمنظّم للأوقات الدقيقة، مثل Africa/Casablanca، أو امسح الأوقات.",
    zone: "استخدم منطقة زمنية مسماة مثل Africa/Casablanca. إذا كانت مجهولة، اتركها فارغة وأدخل التواريخ فقط.",
    nonexistent: "هذا الوقت غير موجود أثناء تغيير الساعة. تحقّق من برنامج المنظّم.",
    occurrence: "اختر التوقيت الأول أو الثاني ضمن إعدادات تغيير الساعة.",
    endAfterStart: "يجب أن تكون النهاية بعد البداية. تحقّق من تاريخها ووقتها، أو اتركهما فارغين إن كانا مجهولين.",
    choice: "اختر أحد الخيارات المتاحة.",
  },
};
