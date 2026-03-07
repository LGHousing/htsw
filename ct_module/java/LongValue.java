public final class LongValue {
    private final long value;

    private LongValue(long value) {
        this.value = value;
    }

    public static LongValue fromString(String s) {
        return new LongValue(Long.parseLong(s));
    }

    public static LongValue fromNumber(double n) {
        return new LongValue((long) n);
    }

    public static LongValue fromBits(int lowBits, int highBits) {
        return new LongValue(((long) highBits << 32) | (lowBits & 0xFFFFFFFFL));
    }

    public static LongValue zero() {
        return new LongValue(0L);
    }

    @Override
    public String toString() {
        return Long.toString(value);
    }

    public double toNumber() {
        return (double) value;
    }

    public int high() {
        return (int) (value >> 32);
    }

    public int low() {
        return (int) value;
    }

    public LongValue add(LongValue other) { return new LongValue(this.value + other.value); }
    public LongValue sub(LongValue other) { return new LongValue(this.value - other.value); }
    public LongValue mul(LongValue other) { return new LongValue(this.value * other.value); }
    public LongValue div(LongValue other) { return new LongValue(this.value / other.value); }
    public LongValue mod(LongValue other) { return new LongValue(this.value % other.value); }

    public LongValue shl(int bits) { return new LongValue(this.value << bits); }
    public LongValue shr(int bits) { return new LongValue(this.value >> bits); }
    public LongValue shru(int bits) { return new LongValue(this.value >>> bits); }

    public LongValue and(LongValue other) { return new LongValue(this.value & other.value); }
    public LongValue or(LongValue other) { return new LongValue(this.value | other.value); }
    public LongValue xor(LongValue other) { return new LongValue(this.value ^ other.value); }

    public boolean eq(LongValue other) { return this.value == other.value; }
    public boolean gt(LongValue other) { return this.value > other.value; }
    public boolean lt(LongValue other) { return this.value < other.value; }
}
