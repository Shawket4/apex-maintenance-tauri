import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
  Image,
} from "@react-pdf/renderer";
import type { InvoiceDetail } from "@/entities/invoice/model";

// ─── Font Registration ────────────────────────────────────────────────────────
Font.register({
  family: "Cairo",
  fonts: [
    { src: "/fonts/Cairo-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/Cairo-Regular.ttf", fontWeight: 700 },
  ],
});

Font.registerHyphenationCallback((word) => [word]);

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  primary: "#0F172A",
  accent: "#1D4ED8",
  text: "#1E293B",
  muted: "#64748B",
  border: "#CBD5E1",
  background: "#F8FAFC",
  white: "#FFFFFF",
};

const FONT = "Cairo";
const PAGE_PADDING = 40;

// ─── Props ────────────────────────────────────────────────────────────────────
export interface ServiceInvoicePdfProps {
  inv: InvoiceDetail;
  isRtl: boolean;
  formatted: {
    id: string;
    date: string;
    meter: string;
    driver: string;
    supervisor: string;
    region: string;
    plate: string;
    fetchedAt: string;
  };
  labels: {
    receiptTitle: string;
    checklistTitle: string;
    truckSubtitle: string;
    colService: string;
    colNotes: string;
    noItems: string;
    labelDate: string;
    labelMeter: string;
    labelDriver: string;
    labelSupervisor: string;
    labelRegion: string;
    labelPlate: string;
    verificationNote: string;
  };
}

// ─── Absolute Layout Engine ───────────────────────────────────────────────────
const createStyles = (isRtl: boolean) => {
  // Instead of relying on buggy CSS direction, we manually structure the flexbox.
  const flexRow = isRtl ? "row-reverse" : "row";
  const textAlign = isRtl ? "right" : "left";

  return StyleSheet.create({
    page: {
      fontFamily: FONT,
      fontSize: 10,
      color: COLORS.text,
      backgroundColor: COLORS.white,
      paddingHorizontal: PAGE_PADDING,
      paddingTop: PAGE_PADDING,
      paddingBottom: 80,
      // We ONLY use direction here so the text engine shapes Arabic letters correctly. 
      // Layout is handled entirely by flexRow below.
      direction: isRtl ? "rtl" : "ltr", 
    },
    
    // ── Header ──
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20,
      paddingBottom: 15,
      borderBottomWidth: 2,
      borderBottomColor: COLORS.primary,
      direction: "ltr", // Ensure Logo is always Left and ID is always Right
    },
    logoBlock: {
      width: 120,
      height: 40,
    },
    invoiceId: {
      fontSize: 14,
      fontWeight: 700,
      color: COLORS.accent,
    },

    // ── Details Form Box ──
    detailsContainer: {
      borderWidth: 1.5,
      borderColor: COLORS.primary,
      padding: 15,
      marginBottom: 25,
      backgroundColor: COLORS.white,
    },
    detailsRow: {
      flexDirection: flexRow, // Flips Column 1 and Column 2
      marginBottom: 16,
    },
    detailsRowLast: {
      flexDirection: flexRow,
      marginBottom: 0,
    },
    metaItem: {
      flex: 1,
      flexDirection: flexRow, // Places Label before Value logically
      alignItems: "flex-end",
      paddingHorizontal: 10,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: COLORS.primary,
    },
    metaValueContainer: {
      flex: 1,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.primary,
      // Apply margin specifically to the side touching the label
      marginLeft: isRtl ? 0 : 8,
      marginRight: isRtl ? 8 : 0,
      paddingBottom: 2,
    },
    metaValue: {
      fontSize: 12,
      fontWeight: 700,
      color: COLORS.accent,
      textAlign: "center",
    },

    // ── Titles ──
    titleSection: {
      textAlign: "center",
      marginBottom: 20,
    },
    titleMain: {
      fontSize: 20,
      fontWeight: 700,
      textTransform: "uppercase",
      color: COLORS.primary,
      letterSpacing: 1,
    },
    titleSub: {
      fontSize: 10,
      color: COLORS.muted,
      textTransform: "uppercase",
      letterSpacing: 3,
      marginTop: 4,
    },

    // ── Table ──
    tableContainer: {
      borderWidth: 1.5,
      borderColor: COLORS.border,
      borderRadius: 6,
      overflow: "hidden",
    },
    tableHeader: {
      flexDirection: flexRow, // Service right, Notes left (in RTL)
      backgroundColor: COLORS.primary,
    },
    tableHeaderCell: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      color: COLORS.white,
      fontSize: 10,
      fontWeight: 700,
      textAlign: textAlign,
      textTransform: "uppercase",
    },
    tableRow: {
      flexDirection: flexRow, // Service right, Notes left (in RTL)
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
      minHeight: 40,
      alignItems: "stretch",
    },
    tableRowLast: {
      borderBottomWidth: 0,
    },
    tableCell: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      justifyContent: "center",
    },
    tableCellText: {
      fontSize: 10,
      textAlign: textAlign,
    },
    cellService: {
      flex: 2,
    },
    cellNotes: {
      flex: 3,
      // Divider line logic: In RTL, Notes are physically on the left, so border goes on the right.
      borderLeftWidth: isRtl ? 0 : 1.5,
      borderRightWidth: isRtl ? 1.5 : 0,
      borderColor: COLORS.border,
    },
    emptyState: {
      padding: 40,
      textAlign: "center",
      color: COLORS.muted,
      fontSize: 11,
    },

    // ── Footer ──
    footer: {
      position: "absolute",
      bottom: 20,
      left: PAGE_PADDING,
      right: PAGE_PADDING,
      flexDirection: flexRow, // Flips note and page number
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    verificationNote: {
      fontSize: 8,
      color: COLORS.muted,
      flex: 1,
      textAlign: textAlign,
    },
    pageNumber: {
      fontSize: 8,
      color: COLORS.muted,
      textAlign: isRtl ? "left" : "right", // Always opposite of text alignment
      width: 50,
    },
  });
};

// ─── Document Component ───────────────────────────────────────────────────────
export function ServiceInvoicePdfDocument({
  inv,
  isRtl,
  formatted,
  labels,
}: ServiceInvoicePdfProps) {
  const styles = createStyles(isRtl);

  // Robust text cleaner to prevent textkit / glyph crashes
  const cleanText = (val: any) => {
    if (val === null || val === undefined) return "—";
    const str = String(val).trim();
    if (!str) return "—";
    // Strip control characters and invisible markers (ZWSP, ZWNJ, etc.) 
    // which often cause "undefined is not an object (evaluating 'glyph.id')" in react-pdf
    return str.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "");
  };

  const MetaItem = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{cleanText(label)}</Text>
      <View style={styles.metaValueContainer}>
        <Text style={styles.metaValue}>{cleanText(value)}</Text>
      </View>
    </View>
  );

  return (
    <Document 
      title={`${cleanText(labels.receiptTitle)} #${cleanText(formatted.id)}`} 
      author="Apex Transport" 
      language={isRtl ? "ar" : "en"}
    >
      <Page size="A4" style={styles.page}>
        
        {/* ── Header ── */}
        <View style={styles.header} fixed>
          <View style={styles.logoBlock}>
            <Image 
              src="/logo.png" 
              style={{ width: "100%", height: "100%", objectFit: "contain" }} 
            />
          </View>
          <View>
            <Text style={styles.invoiceId}>{cleanText(labels.receiptTitle)} #{cleanText(formatted.id)}</Text>
          </View>
        </View>

        {/* ── Details Form Box ── */}
        <View style={styles.detailsContainer}>
          <View style={styles.detailsRow}>
            <MetaItem label={labels.labelDate} value={formatted.date} />
            <MetaItem label={labels.labelDriver} value={formatted.driver} />
          </View>
          <View style={styles.detailsRow}>
            <MetaItem label={labels.labelPlate} value={formatted.plate} />
            <MetaItem label={labels.labelMeter} value={formatted.meter} />
          </View>
          <View style={styles.detailsRowLast}>
            <MetaItem label={labels.labelSupervisor} value={formatted.supervisor} />
            <MetaItem label={labels.labelRegion} value={formatted.region} />
          </View>
        </View>

        {/* ── Checklist Title ── */}
        <View style={styles.titleSection}>
          <Text style={styles.titleMain}>{cleanText(labels.checklistTitle)}</Text>
          <Text style={styles.titleSub}>{cleanText(labels.truckSubtitle)}</Text>
        </View>

        {/* ── Main Table ── */}
        <View style={styles.tableContainer}>
          <View style={styles.tableHeader} fixed>
            <View style={[styles.tableHeaderCell, styles.cellService]}>
              <Text>{cleanText(labels.colService)}</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.cellNotes]}>
              <Text>{cleanText(labels.colNotes)}</Text>
            </View>
          </View>

          {!inv?.items || inv.items.length === 0 ? (
             <View style={styles.tableRowLast}>
                <Text style={styles.emptyState}>{cleanText(labels.noItems)}</Text>
             </View>
          ) : (
            inv.items.map((item, index) => {
              const isLast = index === inv.items.length - 1;
              return (
                 <View 
                  key={item.id} 
                  style={isLast ? [styles.tableRow, styles.tableRowLast] : styles.tableRow} 
                  wrap={false}
                >
                  <View style={[styles.tableCell, styles.cellService]}>
                    <Text style={[styles.tableCellText, { fontWeight: 700, color: COLORS.primary }]}>
                      {cleanText(item.service)}
                    </Text>
                  </View>
                  <View style={[styles.tableCell, styles.cellNotes]}>
                    <Text style={[styles.tableCellText, { color: COLORS.muted }]}>
                      {cleanText(item.notes)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Sticky Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.verificationNote}>
            {cleanText(labels.verificationNote?.replace("{{date}}", cleanText(formatted.fetchedAt)))}
          </Text>
          <Text 
            style={styles.pageNumber} 
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} 
          />
        </View>
        
      </Page>
    </Document>
  );
}

export async function renderInvoicePdfBytes(props: ServiceInvoicePdfProps): Promise<Uint8Array> {
  const blob = await pdf(<ServiceInvoicePdfDocument {...props} />).toBlob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}