import { BytesLiteral, Expr } from "./micheline";
import { MichelsonData } from "./michelson-types";

const primitives = ["parameter", "storage", "code", "False", "Elt", "Left", "None", "Pair",
    "Right", "Some", "True", "Unit", "PACK", "UNPACK", "BLAKE2B", "SHA256", "SHA512", "ABS", "ADD",
    "AMOUNT", "AND", "BALANCE", "CAR", "CDR", "CHECK_SIGNATURE", "COMPARE", "CONCAT", "CONS",
    "CREATE_ACCOUNT", "CREATE_CONTRACT", "IMPLICIT_ACCOUNT", "DIP", "DROP", "DUP", "EDIV", "EMPTY_MAP",
    "EMPTY_SET", "EQ", "EXEC", "FAILWITH", "GE", "GET", "GT", "HASH_KEY", "IF", "IF_CONS", "IF_LEFT",
    "IF_NONE", "INT", "LAMBDA", "LE", "LEFT", "LOOP", "LSL", "LSR", "LT", "MAP", "MEM", "MUL", "NEG",
    "NEQ", "NIL", "NONE", "NOT", "NOW", "OR", "PAIR", "PUSH", "RIGHT", "SIZE", "SOME", "SOURCE",
    "SENDER", "SELF", "STEPS_TO_QUOTA", "SUB", "SWAP", "TRANSFER_TOKENS", "SET_DELEGATE", "UNIT",
    "UPDATE", "XOR", "ITER", "LOOP_LEFT", "ADDRESS", "CONTRACT", "ISNAT", "CAST", "RENAME", "bool",
    "contract", "int", "key", "key_hash", "lambda", "list", "map", "big_map", "nat", "option", "or",
    "pair", "set", "signature", "string", "bytes", "mutez", "timestamp", "unit", "operation",
    "address", "SLICE", "DIG", "DUG", "EMPTY_BIG_MAP", "APPLY", "chain_id", "CHAIN_ID", "LEVEL",
    "SELF_ADDRESS", "never", "NEVER", "UNPAIR", "VOTING_POWER", "TOTAL_VOTING_POWER", "KECCAK",
    "SHA3", "PAIRING_CHECK", "bls12_381_g1", "bls12_381_g2", "bls12_381_fr", "sapling_state",
    "sapling_transaction", "SAPLING_EMPTY_STATE", "SAPLING_VERIFY_UPDATE", "ticket", "TICKET",
    "READ_TICKET", "SPLIT_TICKET", "JOIN_TICKETS", "GET_AND_UPDATE"] as const;

const primTags: { [key: string]: number | undefined } = Object.assign({}, ...primitives.map((v, i) => ({ [v]: i })));

enum Tag {
    Int = 0,
    String = 1,
    Sequence = 2,
    Prim0 = 3,
    Prim0Annot = 4,
    Prim1 = 5,
    Prim1Annot = 6,
    Prim2 = 7,
    Prim2Annot = 8,
    Prim = 9,
    Bytes = 10,
}

class Writer {
    public buffer: number[] = [];

    get length(): number {
        return this.buffer.length;
    }

    writeBytes(val: number[]) {
        this.buffer.push(...val.map(v => v & 0xff));
    }

    writeUint8(val: number) {
        const v = val | 0;
        this.buffer.push(v & 0xff);
    }

    writeUint16(val: number) {
        const v = val | 0;
        this.buffer.push((v >> 8) & 0xff);
        this.buffer.push(v & 0xff);
    }

    writeUint32(val: number) {
        const v = val | 0;
        this.buffer.push((v >> 24) & 0xff);
        this.buffer.push((v >> 16) & 0xff);
        this.buffer.push((v >> 8) & 0xff);
        this.buffer.push(v & 0xff);
    }

    writeInt8(val: number) {
        this.writeUint8(val);
    }

    writeInt16(val: number) {
        this.writeUint16(val);
    }

    writeInt32(val: number) {
        this.writeUint32(val);
    }
}

function encodeBinary(expr: Expr, wr: Writer): void {
    if (Array.isArray(expr)) {
        const w = new Writer();
        for (const v of expr) {
            encodeBinary(v, w);
        }
        wr.writeUint8(Tag.Sequence);
        wr.writeUint32(w.length);
        wr.writeBytes(w.buffer);
        return;
    }

    if ("string" in expr) {
        const enc = new TextEncoder();
        const bytes = enc.encode(expr.string);
        wr.writeUint8(Tag.String);
        wr.writeUint32(bytes.length);
        wr.writeBytes(Array.from(bytes));
        return;
    }

    if ("int" in expr) {
        wr.writeUint8(Tag.Int);
        let val = BigInt(expr.int);
        const sign = val < 0;
        if (sign) {
            val = -val;
        }
        let i = 0;
        do {
            const bits = (i === 0) ? BigInt(6) : BigInt(7);
            let byte = val & ((BigInt(1) << bits) - BigInt(1));
            val >>= bits;
            if (val) {
                byte |= BigInt(0x80);
            }
            if (i === 0 && sign) {
                byte |= BigInt(0x40);
            }
            wr.writeUint8(Number(byte));
            i++;
        } while (val);
        return;
    }

    if ("bytes" in expr) {
        const bytes: number[] = [];
        for (let i = 0; i < expr.bytes.length; i += 2) {
            bytes.push(parseInt(expr.bytes.slice(i, i + 2), 16));
        }
        wr.writeUint8(Tag.Bytes);
        wr.writeUint32(bytes.length);
        wr.writeBytes(bytes);
        return;
    }

    const prim = primTags[expr.prim];
    if (prim === undefined) {
        throw new TypeError(`Can't encode primary: ${expr.prim}`);
    }

    const tag = expr.args?.length || 0 < 3 ?
        Tag.Prim0 + (expr.args?.length || 0) * 2 + (expr.annots === undefined || expr.annots.length === 0 ? 0 : 1) :
        Tag.Prim;

    wr.writeUint8(tag);
    wr.writeUint8(prim);

    if (expr.args !== undefined) {
        if (expr.args.length < 3) {
            for (const a of expr.args) {
                encodeBinary(a, wr);
            }
        } else {
            encodeBinary(expr.args, wr);
        }
    }

    if (expr.annots !== undefined && expr.annots.length !== 0) {
        const enc = new TextEncoder();
        const bytes = enc.encode(expr.annots.join(" "));
        wr.writeUint32(bytes.length);
        wr.writeBytes(Array.from(bytes));
    }
}

export function emitBinary(expr: Expr): number[] {
    const w = new Writer();
    encodeBinary(expr, w);
    return w.buffer;
}
