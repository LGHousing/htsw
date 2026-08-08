import java.math.BigInteger;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

public final class HousingDecimalFormatter {
    private static final BigInteger TEN = BigInteger.TEN;
    private static final ThreadLocal<DecimalFormat> DECIMAL = new ThreadLocal<DecimalFormat>() {
        @Override
        protected DecimalFormat initialValue() {
            return formatter("#,##0.0##");
        }
    };

    private static final ThreadLocal<DecimalFormat> INTEGER = new ThreadLocal<DecimalFormat>() {
        @Override
        protected DecimalFormat initialValue() {
            return formatter("#,##0");
        }
    };

    private HousingDecimalFormatter() {}

    private static final class DecimalDigits {
        final String digits;
        final int decimalAt;

        DecimalDigits(String digits, int decimalAt) {
            this.digits = digits;
            this.decimalAt = decimalAt;
        }
    }

    private static DecimalFormat formatter(String pattern) {
        DecimalFormat formatter = new DecimalFormat(
            pattern,
            DecimalFormatSymbols.getInstance(Locale.US)
        );
        formatter.setRoundingMode(RoundingMode.HALF_EVEN);
        return formatter;
    }

    private static DecimalDigits decimalDigits(double value) {
        String source = Double.toString(value);
        int exponentAt = Math.max(source.indexOf('e'), source.indexOf('E'));
        String coefficient = exponentAt < 0 ? source : source.substring(0, exponentAt);
        int exponent = exponentAt < 0 ? 0 : Integer.parseInt(source.substring(exponentAt + 1));
        int pointAt = coefficient.indexOf('.');
        int decimalAt = pointAt < 0 ? coefficient.length() : pointAt;
        String untrimmed = coefficient.replace(".", "");
        int firstNonzero = 0;
        while (firstNonzero < untrimmed.length() && untrimmed.charAt(firstNonzero) == '0') {
            firstNonzero++;
        }
        return new DecimalDigits(untrimmed.substring(firstNonzero), decimalAt - firstNonzero + exponent);
    }

    private static int compareShortestDecimalToDouble(
        String digits,
        int decimalAt,
        double value
    ) {
        long bits = Double.doubleToRawLongBits(value);
        int exponentBits = (int) ((bits >>> 52) & 0x7ffL);
        long fraction = bits & 0xfffffffffffffL;
        BigInteger mantissa = BigInteger.valueOf(fraction);
        if (exponentBits != 0) mantissa = mantissa.setBit(52);
        int binaryExponent = exponentBits == 0 ? -1074 : exponentBits - 1075;
        int decimalExponent = decimalAt - digits.length();

        BigInteger decimalNumerator = new BigInteger(digits);
        BigInteger decimalDenominator = BigInteger.ONE;
        if (decimalExponent >= 0) decimalNumerator = decimalNumerator.multiply(TEN.pow(decimalExponent));
        else decimalDenominator = TEN.pow(-decimalExponent);

        BigInteger binaryNumerator = mantissa;
        BigInteger binaryDenominator = BigInteger.ONE;
        if (binaryExponent >= 0) binaryNumerator = binaryNumerator.shiftLeft(binaryExponent);
        else binaryDenominator = binaryDenominator.shiftLeft(-binaryExponent);

        return decimalNumerator.multiply(binaryDenominator)
            .compareTo(binaryNumerator.multiply(decimalDenominator));
    }

    private static boolean roundsUp(
        String digits,
        int maximumDigits,
        boolean alreadyRounded,
        boolean valueExactAsDecimal
    ) {
        char roundingDigit = digits.charAt(maximumDigits);
        if (roundingDigit > '5') return true;
        if (roundingDigit < '5') return false;
        if (maximumDigits == digits.length() - 1) {
            if (alreadyRounded) return false;
            if (!valueExactAsDecimal) return true;
            return maximumDigits > 0 && (digits.charAt(maximumDigits - 1) - '0') % 2 != 0;
        }
        for (int i = maximumDigits + 1; i < digits.length(); i++) {
            if (digits.charAt(i) != '0') return true;
        }
        return false;
    }

    public static double quantize(double value) {
        if (Math.floor(value) == value) return value;
        double magnitude = Math.abs(value);
        DecimalDigits decimal = decimalDigits(magnitude);
        String digits = decimal.digits;
        int decimalAt = decimal.decimalAt;
        int comparison = compareShortestDecimalToDouble(digits, decimalAt, magnitude);
        boolean alreadyRounded = comparison > 0;
        boolean valueExactAsDecimal = comparison == 0;

        if (-decimalAt > 3) return Math.copySign(0.0, value);
        if (-decimalAt == 3) {
            boolean up = roundsUp(digits, 0, alreadyRounded, valueExactAsDecimal);
            return up ? Math.copySign(0.001, value) : Math.copySign(0.0, value);
        }

        while (digits.length() > 1 && digits.charAt(digits.length() - 1) == '0') {
            digits = digits.substring(0, digits.length() - 1);
        }
        int maximumDigits = 3 + decimalAt;
        if (maximumDigits >= 0 && maximumDigits < digits.length()) {
            if (roundsUp(digits, maximumDigits, alreadyRounded, valueExactAsDecimal)) {
                String kept = digits.substring(0, maximumDigits);
                String incremented = (kept.isEmpty() ? BigInteger.ZERO : new BigInteger(kept))
                    .add(BigInteger.ONE)
                    .toString();
                if (incremented.length() > maximumDigits) decimalAt++;
                digits = incremented;
            } else {
                digits = digits.substring(0, maximumDigits);
            }
        }

        double rounded = Double.parseDouble(digits + "e" + (decimalAt - digits.length()));
        return Math.copySign(rounded, value);
    }

    public static String formatInput(String source) {
        double value = Double.parseDouble(source);
        boolean decimal = source.indexOf('.') >= 0 || source.indexOf('e') >= 0 || source.indexOf('E') >= 0;
        return decimal ? DECIMAL.get().format(quantize(value)) : INTEGER.get().format(value);
    }

    public static void main(String[] args) {
        for (String arg : args) System.out.println(formatInput(arg));
    }
}
