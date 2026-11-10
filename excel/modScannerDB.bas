Attribute VB_Name = "modScannerDB"
'=====================================================================
' SCANNER DATABASE  v1.5   (KuCoin Spot)
'---------------------------------------------------------------------
' Timeframes : 1day / 4hour / 15min
' Sheets     : SC_Config  (settings + control panel)
'              <Symbol>_<TF>  e.g. ETH-USDT_1day  (one sheet per TF)
' Columns    : Timestamp(UTC sec) | Open | High | Low | Close |
'              Volume | Turnover | Time(UTC)
' Rules      : - only CLOSED candles are stored (no partial candle)
'              - rows sorted ascending, no duplicates
'              - after each update -> ScannerData.js is exported next
'                to this workbook for ScannerApp.html
' Entry points (buttons on SC_Config):
'   SC_Setup, SC_UpdateAll, SC_FullRebuild, SC_AutoStart,
'   SC_AutoStop, SC_Export, SC_AddSymbols, SC_Backfill, SC_SetHistoryDays
' Independent of all old modules (all helpers are Private).
'=====================================================================
Option Explicit

Private Const CFG_SHEET As String = "SC_Config"
Private Const API_URL As String = "https://api.kucoin.com/api/v1/market/candles"
Private Const MAX_PER_REQ As Long = 1400        'KuCoin max = 1500
Private Const REQ_PAUSE As Double = 0.6         'seconds between requests
Private Const HTTP_TIMEOUT As Double = 20       'seconds per request
Private Const EXPORT_FILE As String = "ScannerData.js"
Private Const AUTO_DELAY_SEC As Long = 20       'run 20s after 15m close

'--- SC_Config columns
Private Const C_SYMBOL As Long = 1
Private Const C_TF As Long = 2
Private Const C_SHEET As Long = 3
Private Const C_ACTIVE As Long = 4
Private Const C_DAYS As Long = 5
Private Const C_MODE As Long = 6
Private Const C_LAST As Long = 7
Private Const C_COUNT As Long = 8
Private Const C_GAPS As Long = 9
Private Const C_STATUS As Long = 10
Private Const C_UPDATED As Long = 11
Private Const C_FIRST As Long = 12
Private Const C_LASTCOL As Long = 12

'--- control panel cells (on SC_Config)
Private Const P_AUTO As String = "N3"
Private Const P_NEXT As String = "N4"
Private Const P_LASTRUN As String = "N5"
Private Const P_EXPORT As String = "N6"
Private Const P_BUDGET As String = "N7"
Private Const P_SCAN As String = "N17"
Private Const SCAN_FILE As String = "ScannerScan.js"
Private Const ROLL_DAYS As Long = 30          '15min rows with HistoryDays <= this are rolling (old rows trimmed)
Private Const SCAN_TOP As Long = 100
Private Const SCAN_MINVOL As Double = 1000000   'min 24h volume (USDT)
Private Const SCAN_D As Long = 500           'daily candles per coin
Private Const SCAN_H As Long = 1500          '4H candles per coin (~250 days)
Private Const INITIAL_DAYS As Long = 180     'FULL build downloads at most this; Backfill adds the rest

Private mNextRun As Date
Private mAbort As Boolean


'=====================================================================
' PUBLIC : SETUP
'=====================================================================
Public Sub SC_Setup()
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(CFG_SHEET)

    If Trim$(CStr(ws.Cells(1, 1).Value)) = "" Then
        ws.Range("A1").Resize(1, C_LASTCOL).Value = Array( _
            "Symbol", "TimeFrame", "SheetName", "Active", "HistoryDays", _
            "Mode", "LastCandle(UTC)", "Candles", "Gaps", "Status", "Updated", "FirstCandle(UTC)")
        AddConfigRow ws, 2, "ETH-USDT", "1day"
        AddConfigRow ws, 3, "ETH-USDT", "4hour"
        AddConfigRow ws, 4, "ETH-USDT", "15min"
    End If

    With ws.Range("A1").Resize(1, C_LASTCOL)
        .Font.Bold = True
        .Interior.Color = RGB(31, 41, 55)
        .Font.Color = vbWhite
    End With
    ws.Columns("A:L").ColumnWidth = 14
    ws.Columns("J").ColumnWidth = 40

    ws.Range("M2").Value = "CONTROL PANEL"
    ws.Range("M2").Font.Bold = True
    ws.Range("M3").Value = "Auto":        ws.Range(P_AUTO).Value = "OFF"
    ws.Range("M4").Value = "Next run":    ws.Range(P_NEXT).Value = ""
    ws.Range("M5").Value = "Last run":    ws.Range(P_LASTRUN).Value = ""
    ws.Range("M6").Value = "Export file": ws.Range(P_EXPORT).Value = ""
    ws.Range("M7").Value = "Backfill req/run"
    If Val(ws.Range(P_BUDGET).Value) <= 0 Then ws.Range(P_BUDGET).Value = 30
    EnsureFirstHeader ws
    ws.Columns("M").ColumnWidth = 12
    ws.Columns("N").ColumnWidth = 24

    CreateButtons ws
    ws.Activate
    MsgBox "SC_Config is ready." & vbCrLf & _
           "Mode = FULL builds history, then switches to UPDATE automatically.", vbInformation
End Sub

Private Sub AddConfigRow(ws As Worksheet, r As Long, sym As String, tf As String)
    ws.Cells(r, C_SYMBOL).Value = sym
    ws.Cells(r, C_TF).Value = tf
    ws.Cells(r, C_SHEET).Value = sym & "_" & tf
    ws.Cells(r, C_ACTIVE).Value = "YES"
    ws.Cells(r, C_DAYS).Value = 730
    ws.Cells(r, C_MODE).Value = "FULL"
End Sub

Private Sub CreateButtons(ws As Worksheet)
    Dim shp As Shape
    For Each shp In ws.Shapes
        If Left$(shp.Name, 4) = "scb_" Then shp.Delete
    Next shp
    AddButton ws, "scb_upd", "Update + Export", "SC_UpdateAll", 8, RGB(22, 163, 74)
    AddButton ws, "scb_full", "Full Rebuild", "SC_FullRebuild", 9, RGB(220, 38, 38)
    AddButton ws, "scb_on", "Auto ON (15m)", "SC_AutoStart", 10, RGB(37, 99, 235)
    AddButton ws, "scb_off", "Auto OFF", "SC_AutoStop", 11, RGB(75, 85, 99)
    AddButton ws, "scb_exp", "Export only", "SC_Export", 12, RGB(124, 58, 237)
    AddButton ws, "scb_add", "Add Symbols", "SC_AddSymbols", 13, RGB(217, 119, 6)
    AddButton ws, "scb_bf", "Backfill History", "SC_Backfill", 14, RGB(13, 148, 136)
    AddButton ws, "scb_days", "Set History Days", "SC_SetHistoryDays", 15, RGB(100, 116, 139)
    AddButton ws, "scb_scan", "Sync Top 100", "SC_SyncTop100", 16, RGB(190, 24, 93)
    ws.Range("M17").Value = "Last scan"
End Sub

Private Sub AddButton(ws As Worksheet, nm As String, caption As String, _
                      macroName As String, rowNo As Long, clr As Long)
    Dim shp As Shape, c As Range
    Set c = ws.Range("M" & rowNo)
    Set shp = ws.Shapes.AddShape(msoShapeRoundedRectangle, c.Left, c.Top + 1, 210, c.Height * 0.92)
    shp.Name = nm
    shp.Fill.ForeColor.RGB = clr
    shp.Line.Visible = msoFalse
    shp.TextFrame2.TextRange.Text = caption
    shp.TextFrame2.TextRange.Font.Size = 10
    shp.TextFrame2.TextRange.Font.Bold = msoTrue
    shp.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = vbWhite
    shp.TextFrame2.TextRange.ParagraphFormat.Alignment = msoAlignCenter
    shp.TextFrame2.VerticalAnchor = msoAnchorMiddle
    shp.OnAction = macroName
End Sub


'=====================================================================
' PUBLIC : BUTTON ENTRY POINTS
'=====================================================================
Public Sub SC_UpdateAll()
    RunAll False, False
End Sub

Public Sub SC_FullRebuild()
    If MsgBox("Rebuild ALL active sheets from scratch?", vbYesNo + vbQuestion) = vbYes Then
        RunAll True, False
    End If
End Sub

Public Sub SC_AddSymbols()
    Dim s As String, arr() As String, i As Long, j As Long, r As Long
    Dim sym As String, ws As Worksheet, tfs As Variant, added As Long

    s = InputBox("Symbols to add (comma separated)." & vbCrLf & _
                 "Short form is OK: BTC = BTC-USDT", "Add Symbols", _
                 "BTC,SOL,BNB,XRP,DOGE,ADA,AVAX,LINK")
    If Trim$(s) = "" Then Exit Sub

    Set ws = ThisWorkbook.Worksheets(CFG_SHEET)
    tfs = Array("1day", "4hour", "15min")
    arr = Split(Replace(UCase$(s), " ", ""), ",")
    For i = 0 To UBound(arr)
        sym = arr(i)
        If Len(sym) > 0 Then
            If InStr(1, sym, "-") = 0 Then sym = sym & "-USDT"
            For j = 0 To 2
                If Not ConfigRowExists(ws, sym, CStr(tfs(j))) Then
                    r = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row + 1
                    AddConfigRow ws, r, sym, CStr(tfs(j))
                    added = added + 1
                End If
            Next j
        End If
    Next i
    MsgBox added & " rows added (Mode = FULL)." & vbCrLf & _
           "Now press 'Update + Export' to download them.", vbInformation
End Sub

Private Function ConfigRowExists(ws As Worksheet, sym As String, tf As String) As Boolean
    Dim r As Long, lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row
    For r = 2 To lastRow
        If UCase$(Trim$(CStr(ws.Cells(r, C_SYMBOL).Value))) = sym And _
           LCase$(Trim$(CStr(ws.Cells(r, C_TF).Value))) = tf Then
            ConfigRowExists = True
            Exit Function
        End If
    Next r
End Function

'=====================================================================
' BACKFILL : extend history backwards little by little (API friendly)
'   - each run uses at most N requests (SC_Config!N7, default 30)
'   - order: all 1day rows, then 4hour, then 15min
'   - stops per row when HistoryDays is reached or the coin's listing start
'=====================================================================
Public Sub SC_Backfill()
    Dim ws As Worksheet, used As Long, t0 As Double
    Set ws = ThisWorkbook.Worksheets(CFG_SHEET)
    t0 = Timer
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.EnableCancelKey = xlErrorHandler
    mAbort = False
    used = BackfillAll(ws, False)
    ExportForApp
    Application.EnableCancelKey = xlInterrupt
    Application.StatusBar = False
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox IIf(mAbort, "STOPPED by user (Esc)." & vbCrLf, "") & _
           "Backfill: " & used & " API requests in " & Format(Timer - t0, "0") & " s" & vbCrLf & _
           "Rows still incomplete: " & CountIncomplete(ws) & vbCrLf & _
           "Press again (or keep Auto ON) to continue.", vbInformation
End Sub

Private Function BackfillAll(ws As Worksheet, silent As Boolean) As Long
    Dim budget As Long, used As Long, pass As Long, r As Long, lastRow As Long, tfOrder As Variant
    EnsureFirstHeader ws
    budget = CLng(Val(ws.Range(P_BUDGET).Value))
    If budget <= 0 Then budget = 30
    tfOrder = Array("1day", "4hour", "15min")
    lastRow = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row
    For pass = 0 To 2
        For r = 2 To lastRow
            If used >= budget Or mAbort Then Exit For
            If UCase$(Trim$(CStr(ws.Cells(r, C_ACTIVE).Value))) = "YES" _
               And LCase$(Trim$(CStr(ws.Cells(r, C_TF).Value))) = tfOrder(pass) _
               And UCase$(Trim$(CStr(ws.Cells(r, C_MODE).Value))) = "UPDATE" Then
                used = used + BackfillRow(ws, r, budget - used)
                If Not silent And ThisWorkbook.Path <> "" And (r Mod 25 = 0) Then ThisWorkbook.Save
            End If
        Next r
    Next pass
    BackfillAll = used
End Function

'returns number of API requests used
Private Function BackfillRow(wsCfg As Worksheet, r As Long, maxReq As Long) As Long
    Dim sym As String, tf As String, stepSec As Long, days As Long, ws As Worksheet
    Dim firstTs As Double, targetTs As Double, fromTs As Double, d As Object, n As Long, newFirst As Double
    Dim stateTxt As String

    On Error GoTo Fail
    stateTxt = CStr(wsCfg.Cells(r, C_FIRST).Value)
    If InStr(1, stateTxt, "listing start") > 0 Or InStr(1, stateTxt, "complete") > 0 Then Exit Function

    ReadRow wsCfg, r, sym, tf, stepSec, days, ws
    If ws.Cells(ws.Rows.Count, 1).End(xlUp).Row < 2 Then Exit Function
    firstTs = CDbl(ws.Cells(2, 1).Value)
    targetTs = Int((NowUtcTs() - CDbl(days) * 86400#) / stepSec) * stepSec
    If firstTs <= targetTs Then
        wsCfg.Cells(r, C_FIRST).Value = stateTxt & "  (complete)"
        Exit Function
    End If

    fromTs = firstTs - CDbl(maxReq) * MAX_PER_REQ * stepSec
    If fromTs < targetTs Then fromTs = targetTs
    wsCfg.Cells(r, C_STATUS).Value = "backfilling..."
    Set d = CreateObject("Scripting.Dictionary")
    BackfillRow = FetchRange(sym, tf, stepSec, fromTs, firstTs, d)
    n = PrependCandles(ws, d, stepSec, firstTs)

    ValidateRow wsCfg, r
    newFirst = CDbl(ws.Cells(2, 1).Value)
    If n = 0 Or newFirst > fromTs + 2 * stepSec Then
        'exchange has no older data -> coin listing start reached
        If newFirst > targetTs Then wsCfg.Cells(r, C_FIRST).Value = CStr(wsCfg.Cells(r, C_FIRST).Value) & "  (listing start)"
    End If
    If newFirst <= targetTs Then wsCfg.Cells(r, C_FIRST).Value = Replace(CStr(wsCfg.Cells(r, C_FIRST).Value), "  (complete)", "") & "  (complete)"
    wsCfg.Cells(r, C_STATUS).Value = "OK  (backfill +" & n & " candles)"
    wsCfg.Cells(r, C_UPDATED).Value = Now
    Exit Function
Fail:
    If Err.Number = 18 Then mAbort = True
    wsCfg.Cells(r, C_STATUS).Value = "BACKFILL paused: " & Err.Description & " (will retry next run)"
    BackfillRow = maxReq            'stop using budget this run
End Function

'insert older candles (ts < beforeTs) at the top of the sheet
Private Function PrependCandles(ws As Worksheet, d As Object, stepSec As Long, beforeTs As Double) As Long
    Dim keys() As Double, k As Variant, n As Long, i As Long, m As Long, arr() As Variant, v As Variant

    If d.Count = 0 Then Exit Function
    ReDim keys(0 To d.Count - 1)
    For Each k In d.keys
        keys(n) = CDbl(k): n = n + 1
    Next k
    QuickSort keys, 0, n - 1
    ReDim arr(1 To n, 1 To 8)
    For i = 0 To n - 1
        If keys(i) < beforeTs Then
            m = m + 1
            v = d(keys(i))
            arr(m, 1) = keys(i)
            arr(m, 2) = v(0): arr(m, 3) = v(1): arr(m, 4) = v(2): arr(m, 5) = v(3)
            arr(m, 6) = v(4): arr(m, 7) = v(5)
            arr(m, 8) = DateSerial(1970, 1, 1) + keys(i) / 86400#
        End If
    Next i
    If m = 0 Then Exit Function
    ws.Rows("2:" & (m + 1)).Insert Shift:=xlDown
    ws.Cells(2, 1).Resize(m, 8).Value = SliceRows(arr, m)
    ws.Range(ws.Cells(2, 8), ws.Cells(m + 1, 8)).NumberFormat = "yyyy-mm-dd hh:mm"
    PrependCandles = m
End Function

Private Function CountIncomplete(ws As Worksheet) As Long
    Dim r As Long, lastRow As Long, t As String
    lastRow = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row
    For r = 2 To lastRow
        If UCase$(Trim$(CStr(ws.Cells(r, C_ACTIVE).Value))) = "YES" Then
            t = CStr(ws.Cells(r, C_FIRST).Value)
            If InStr(1, t, "complete") = 0 And InStr(1, t, "listing start") = 0 Then CountIncomplete = CountIncomplete + 1
        End If
    Next r
End Function

Private Sub EnsureFirstHeader(ws As Worksheet)
    If Trim$(CStr(ws.Cells(1, C_FIRST).Value)) = "" Then
        ws.Cells(1, C_FIRST).Value = "FirstCandle(UTC)"
        ws.Cells(1, C_FIRST).Font.Bold = True
        ws.Cells(1, C_FIRST).Interior.Color = RGB(31, 41, 55)
        ws.Cells(1, C_FIRST).Font.Color = vbWhite
        ws.Columns(C_FIRST).ColumnWidth = 30
    End If
End Sub

Public Sub SC_SetHistoryDays()
    Dim v As String, ws As Worksheet, r As Long, lastRow As Long, t As String
    v = InputBox("History days for ALL rows (e.g. 730 = 2 years):", "History", "730")
    If Val(v) <= 0 Then Exit Sub
    Set ws = ThisWorkbook.Worksheets(CFG_SHEET)
    lastRow = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row
    For r = 2 To lastRow
        ws.Cells(r, C_DAYS).Value = CLng(Val(v))
        t = CStr(ws.Cells(r, C_FIRST).Value)
        ws.Cells(r, C_FIRST).Value = Replace(t, "  (complete)", "")    'listing start stays
    Next r
    MsgBox "HistoryDays = " & CLng(Val(v)) & " for all rows." & vbCrLf & _
           "Now press 'Backfill History' (repeat until complete) or keep Auto ON.", vbInformation
End Sub

'=====================================================================
' TOP-100 : helpers used by SC_SyncTop100 (coins are stored in the DB;
'           ScannerScan.js is exported from the DB by ExportForApp)
'=====================================================================
Public Sub SC_SyncTop100()
    'adds the 100 most liquid KuCoin USDT pairs to SC_Config (existing rows are never touched)
    '  1day + 4hour : HistoryDays 730 (first 180 days now, the rest via Backfill)
    '  15min        : HistoryDays 10, rolling (older rows trimmed automatically)
    Dim ws As Worksheet, vols As Object, syms As Collection, i As Long, j As Long, r As Long, added As Long, sym As String
    Dim tfs As Variant, days As Variant
    On Error GoTo Fail
    Set ws = ThisWorkbook.Worksheets(CFG_SHEET)
    Set vols = CreateObject("Scripting.Dictionary")
    Application.StatusBar = "Sync: reading KuCoin tickers ..."
    Set syms = TopSymbols(SCAN_TOP, vols)
    tfs = Array("1day", "4hour", "15min"): days = Array(730, 730, 10)
    For i = 1 To syms.Count
        sym = syms(i)
        For j = 0 To 2
            If Not ConfigRowExists(ws, sym, CStr(tfs(j))) Then
                r = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row + 1
                AddConfigRow ws, r, sym, CStr(tfs(j))
                ws.Cells(r, C_DAYS).Value = days(j)
                added = added + 1
            End If
        Next j
    Next i
    Application.StatusBar = False
    MsgBox syms.Count & " coins checked, " & added & " new rows added (Mode = FULL)." & vbCrLf & vbCrLf & _
           "Next: press 'Update + Export' (first time ~5-10 min)," & vbCrLf & _
           "then keep Auto ON - Backfill completes 2-year history gradually.", vbInformation
    Exit Sub
Fail:
    Application.StatusBar = False
    MsgBox "Sync error: " & Err.Description, vbExclamation
End Sub

'top-N USDT pairs by 24h quote volume (stablecoins, gold, leveraged tokens excluded)
Private Function TopSymbols(topN As Long, vols As Object) As Collection
    Dim txt As String, chunks() As String, i As Long, k As Long, sym As String, base As String, v As Double
    Dim names() As String, vals() As Double, n As Long, best As Long, out As New Collection
    Const EXCL As String = "|USDC|USDT|DAI|TUSD|FDUSD|USDD|PYUSD|USDE|USDP|BUSD|EUR|EURT|EURC|EURI|GBP|AEUR|XAUT|PAXG|USD1|RLUSD|USDS|USDG|USDQ|USDR|"

    txt = HttpGet("https://api.kucoin.com/api/v1/market/allTickers")
    chunks = Split(txt, "{""symbol"":""")
    ReDim names(1 To UBound(chunks) + 1): ReDim vals(1 To UBound(chunks) + 1)
    For i = 1 To UBound(chunks)
        sym = Left$(chunks(i), InStr(1, chunks(i), """") - 1)
        If Right$(sym, 5) = "-USDT" Then
            base = Left$(sym, Len(sym) - 5)
            If InStr(1, EXCL, "|" & base & "|") = 0 And Not (Right$(base, 2) Like "#[LS]") Then
                v = Val(JsonVal(chunks(i), "volValue"))
                If v >= SCAN_MINVOL Then n = n + 1: names(n) = sym: vals(n) = v
            End If
        End If
    Next i
    For k = 1 To IIf(topN < n, topN, n)                 'partial selection sort (descending)
        best = k
        For i = k + 1 To n
            If vals(i) > vals(best) Then best = i
        Next i
        If best <> k Then
            v = vals(k): vals(k) = vals(best): vals(best) = v
            sym = names(k): names(k) = names(best): names(best) = sym
        End If
        out.Add names(k)
        vols(names(k)) = vals(k)
    Next k
    If out.Count = 0 Then Err.Raise vbObjectError + 701, , "allTickers returned no USDT pairs"
    Set TopSymbols = out
End Function

Private Function JsonVal(chunk As String, key As String) As String
    Dim p As Long, q As Long
    p = InStr(1, chunk, """" & key & """:")
    If p = 0 Then Exit Function
    p = p + Len(key) + 3
    If Mid$(chunk, p, 1) = """" Then
        q = InStr(p + 1, chunk, """")
        JsonVal = Mid$(chunk, p + 1, q - p - 1)
    Else
        q = p
        Do While q <= Len(chunk) And InStr(1, ",}", Mid$(chunk, q, 1)) = 0
            q = q + 1
        Loop
        JsonVal = Mid$(chunk, p, q - p)
    End If
End Function

'one request: last nBars candles (KuCoin max 1500 per request)
Private Sub FetchLast(sym As String, tf As String, stepSec As Long, nBars As Long, nowTs As Double, d As Object)
    Dim fromTs As Double
    fromTs = Int((nowTs - CDbl(nBars) * stepSec) / stepSec) * stepSec
    ParseKucoin HttpGet(API_URL & "?type=" & tf & "&symbol=" & sym & "&startAt=" & Format$(fromTs, "0") & "&endAt=" & Format$(nowTs, "0")), d
End Sub

'closed candles only, ascending: [[ts,o,h,l,c,v,q],...]
Private Function RowsJson(d As Object, stepSec As Long, nowTs As Double) As String
    Dim keys() As Double, k As Variant, n As Long, i As Long, m As Long, rows() As String, v As Variant
    If d.Count = 0 Then RowsJson = "[]": Exit Function
    ReDim keys(0 To d.Count - 1)
    For Each k In d.keys
        keys(n) = CDbl(k): n = n + 1
    Next k
    QuickSort keys, 0, n - 1
    ReDim rows(1 To n)
    For i = 0 To n - 1
        If keys(i) + stepSec <= nowTs Then
            v = d(keys(i)): m = m + 1
            rows(m) = "[" & Num(keys(i)) & "," & Num(v(0)) & "," & Num(v(1)) & "," & Num(v(2)) & "," & Num(v(3)) & "," & Num(v(4)) & "," & Num(v(5)) & "]"
        End If
    Next i
    If m = 0 Then RowsJson = "[]": Exit Function
    ReDim Preserve rows(1 To m)
    RowsJson = "[" & Join(rows, ",") & "]"
End Function

Public Sub SC_Export()
    Dim p As String
    p = ExportForApp()
    If Len(p) > 0 Then MsgBox "Exported:" & vbCrLf & p, vbInformation
End Sub


'=====================================================================
' MAIN RUNNER
'=====================================================================
Private Sub RunAll(forceFull As Boolean, silent As Boolean, Optional doBackfill As Boolean = False)
    Dim ws As Worksheet, lastRow As Long, r As Long
    Dim nFull As Long, nUpd As Long, nErr As Long
    Dim mode As String, t0 As Double

    Set ws = ThisWorkbook.Worksheets(CFG_SHEET)
    lastRow = ws.Cells(ws.Rows.Count, C_SYMBOL).End(xlUp).Row
    t0 = Timer

    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.EnableCancelKey = xlErrorHandler     'Esc = stop safely
    mAbort = False

    For r = 2 To lastRow
        If mAbort Then Exit For
        If UCase$(Trim$(CStr(ws.Cells(r, C_ACTIVE).Value))) = "YES" Then
            mode = UCase$(Trim$(CStr(ws.Cells(r, C_MODE).Value)))
            If forceFull Then mode = "FULL"
            If mode = "" Then mode = "UPDATE"
            Select Case ProcessRow(ws, r, mode)
                Case "FULL": nFull = nFull + 1
                Case "UPDATE": nUpd = nUpd + 1
                Case "ERROR": nErr = nErr + 1
            End Select
            If Not silent And ThisWorkbook.Path <> "" And (r Mod 25 = 0) Then ThisWorkbook.Save   'keep progress

        End If
    Next r

    If doBackfill And Not mAbort Then BackfillAll ws, True
    ExportForApp
    ws.Range(P_LASTRUN).Value = Now

    Application.EnableCancelKey = xlInterrupt
    Application.StatusBar = False
    Application.EnableEvents = True
    Application.ScreenUpdating = True

    If Not silent Then
        MsgBox IIf(mAbort, "STOPPED by user (Esc). Press Update again to continue." & vbCrLf, "") & _
               "Done in " & Format(Timer - t0, "0.0") & " s" & vbCrLf & _
               "FULL: " & nFull & "   UPDATE: " & nUpd & "   ERRORS: " & nErr, _
               IIf(nErr > 0, vbExclamation, vbInformation)
    End If
End Sub


Private Sub TrimRolling(wsCfg As Worksheet, r As Long)
    Dim days As Long, ws As Worksheet, lastRow As Long, a As Variant, keepTs As Double, k As Long
    If LCase$(Trim$(CStr(wsCfg.Cells(r, C_TF).Value))) <> "15min" Then Exit Sub
    days = CLng(Val(wsCfg.Cells(r, C_DAYS).Value))
    If days <= 0 Or days > ROLL_DAYS Then Exit Sub
    Set ws = ThisWorkbook.Worksheets(Trim$(CStr(wsCfg.Cells(r, C_SHEET).Value)))
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow < 3 Then Exit Sub
    keepTs = NowUtcTs() - CDbl(days) * 86400#
    a = ws.Range("A2:A" & lastRow).Value
    For k = 1 To UBound(a, 1)
        If a(k, 1) >= keepTs Then Exit For
    Next k
    If k > 1 + 96 Then ws.Rows("2:" & k).Delete       'trim in chunks of at least one day
End Sub

'returns "FULL" / "UPDATE" / "SKIP" / "ERROR"
Private Function ProcessRow(ws As Worksheet, r As Long, mode As String) As String
    Dim added As Long
    On Error GoTo Fail
    ws.Cells(r, C_STATUS).Value = "running..."
    Select Case mode
        Case "FULL"
            added = BuildFull(ws, r)
            ws.Cells(r, C_MODE).Value = "UPDATE"
        Case "UPDATE"
            added = UpdateSheet(ws, r)
            TrimRolling ws, r
        Case Else
            ws.Cells(r, C_STATUS).Value = "SKIP (Mode must be FULL or UPDATE)"
            ProcessRow = "SKIP"
            Exit Function
    End Select
    ValidateRow ws, r
    ws.Cells(r, C_STATUS).Value = "OK  (+" & added & " candles)"
    ws.Cells(r, C_UPDATED).Value = Now
    ProcessRow = mode
    Exit Function
Fail:
    If Err.Number = 18 Then
        mAbort = True
        ws.Cells(r, C_STATUS).Value = "STOPPED (Esc) - press Update to continue"
        ProcessRow = "SKIP"
        Exit Function
    End If
    ws.Cells(r, C_STATUS).Value = "ERROR: " & Err.Description
    ws.Cells(r, C_UPDATED).Value = Now
    ProcessRow = "ERROR"
End Function


'=====================================================================
' FULL BUILD  (returns number of candles written)
'=====================================================================
Private Function BuildFull(wsCfg As Worksheet, r As Long) As Long
    Dim sym As String, tf As String, stepSec As Long, days As Long
    Dim nowTs As Double, fromTs As Double, d As Object, ws As Worksheet

    ReadRow wsCfg, r, sym, tf, stepSec, days, ws
    nowTs = NowUtcTs()
    If days > INITIAL_DAYS Then days = INITIAL_DAYS       'older history comes from Backfill
    fromTs = Int((nowTs - CDbl(days) * 86400#) / stepSec) * stepSec

    Set d = CreateObject("Scripting.Dictionary")
    FetchRange sym, tf, stepSec, fromTs, nowTs, d

    ws.Cells.ClearContents
    WriteHeader ws
    BuildFull = WriteCandles(ws, d, stepSec, nowTs, -1, 2)
End Function


'=====================================================================
' INCREMENTAL UPDATE
'=====================================================================
Private Function UpdateSheet(wsCfg As Worksheet, r As Long) As Long
    Dim sym As String, tf As String, stepSec As Long, days As Long
    Dim nowTs As Double, lastTs As Double, d As Object, ws As Worksheet
    Dim lastRow As Long

    ReadRow wsCfg, r, sym, tf, stepSec, days, ws
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow < 2 Or Not IsNumeric(ws.Cells(lastRow, 1).Value) Then
        UpdateSheet = BuildFull(wsCfg, r)
        Exit Function
    End If

    lastTs = CDbl(ws.Cells(lastRow, 1).Value)
    nowTs = NowUtcTs()
    If lastTs + 2 * stepSec > nowTs Then Exit Function   'nothing new closed yet

    Set d = CreateObject("Scripting.Dictionary")
    FetchRange sym, tf, stepSec, lastTs, nowTs, d
    UpdateSheet = WriteCandles(ws, d, stepSec, nowTs, lastTs, lastRow + 1)
End Function

Private Sub ReadRow(wsCfg As Worksheet, r As Long, ByRef sym As String, ByRef tf As String, _
                    ByRef stepSec As Long, ByRef days As Long, ByRef ws As Worksheet)
    Dim sh As String
    sym = UCase$(Trim$(CStr(wsCfg.Cells(r, C_SYMBOL).Value)))
    tf = LCase$(Trim$(CStr(wsCfg.Cells(r, C_TF).Value)))
    sh = Trim$(CStr(wsCfg.Cells(r, C_SHEET).Value))
    If sh = "" Then sh = sym & "_" & tf: wsCfg.Cells(r, C_SHEET).Value = sh
    stepSec = TfSeconds(tf)
    If stepSec = 0 Then Err.Raise vbObjectError + 600, , "Unknown TimeFrame: " & tf
    days = CLng(Val(wsCfg.Cells(r, C_DAYS).Value))
    If days <= 0 Then days = 180
    Set ws = GetOrCreateSheet(sh)
    If Trim$(CStr(ws.Cells(1, 1).Value)) <> "Timestamp" Then WriteHeader ws
End Sub

Private Function TfSeconds(tf As String) As Long
    Select Case LCase$(tf)
        Case "1min": TfSeconds = 60
        Case "5min": TfSeconds = 300
        Case "15min": TfSeconds = 900
        Case "30min": TfSeconds = 1800
        Case "1hour": TfSeconds = 3600
        Case "2hour": TfSeconds = 7200
        Case "4hour": TfSeconds = 14400
        Case "1day": TfSeconds = 86400
        Case "1week": TfSeconds = 604800
        Case Else: TfSeconds = 0
    End Select
End Function


'=====================================================================
' API : download candles in windows -> dictionary(ts) = Array(O,H,L,C,V,T)
'=====================================================================
Private Function FetchRange(sym As String, tf As String, stepSec As Long, _
                       fromTs As Double, toTs As Double, d As Object) As Long
    Dim curEnd As Double, winStart As Double, url As String, nReq As Long, total As Long

    total = Int((toTs - fromTs) / (CDbl(stepSec) * MAX_PER_REQ)) + 1
    curEnd = toTs
    Do While curEnd > fromTs
        winStart = curEnd - CDbl(stepSec) * MAX_PER_REQ
        If winStart < fromTs Then winStart = fromTs
        url = API_URL & "?type=" & tf & "&symbol=" & sym & _
              "&startAt=" & Format$(winStart, "0") & "&endAt=" & Format$(curEnd, "0")
        ParseKucoin HttpGet(url), d
        nReq = nReq + 1
        Application.StatusBar = "Scanner DB: " & sym & " " & tf & "  request " & nReq & "/" & total & _
                                "  candles: " & d.Count
        curEnd = winStart
        If curEnd > fromTs Then WaitSec REQ_PAUSE
    Loop
    FetchRange = nReq
End Function

Private Function HttpGet(url As String) As String
    'async request + timeout -> Excel never freezes on a hung connection
    Dim http As Object, tries As Long, st As Long, txt As String, msg As String, t0 As Double
    For tries = 1 To 5
        st = 0: txt = "": msg = ""
        On Error Resume Next
        Set http = CreateObject("MSXML2.XMLHTTP")
        http.Open "GET", url, True
        http.setRequestHeader "Cache-Control", "no-cache"
        http.setRequestHeader "If-Modified-Since", "Sat, 01 Jan 2000 00:00:00 GMT"
        http.send
        If Err.Number <> 0 Then msg = Err.Description
        Err.Clear
        On Error GoTo 0

        If msg = "" Then
            t0 = Timer
            Do While http.readyState <> 4
                DoEvents
                If mAbort Then Err.Raise 18
                If Timer - t0 > HTTP_TIMEOUT Or Timer < t0 Then Exit Do
            Loop
            On Error Resume Next
            If http.readyState = 4 Then
                st = http.Status
                txt = http.responseText
            Else
                http.abort
                msg = "timeout (" & HTTP_TIMEOUT & "s)"
            End If
            Err.Clear
            On Error GoTo 0
        End If

        If st = 200 And InStr(1, txt, """code"":""200000""") > 0 Then
            HttpGet = txt
            Exit Function
        End If
        If st = 429 Or InStr(1, txt, "429000") > 0 Then
            msg = "rate limit (429)"
            Application.StatusBar = "Scanner DB: API rate limit - waiting " & (5 * tries) & " s ..."
            WaitSec 5 * tries
        Else
            If st <> 0 Then msg = "HTTP " & st & " " & Left$(txt, 150)
            Application.StatusBar = "Scanner DB: " & msg & " - retry " & tries & "/5"
            WaitSec 2 * tries
        End If
    Next tries
    Err.Raise vbObjectError + 601, "HttpGet", "API failed: " & msg
End Function

'KuCoin row = [time, open, close, high, low, volume, turnover]  (newest first)
Private Sub ParseKucoin(txt As String, d As Object)
    Dim p As Long, q As Long, body As String, rows() As String, f() As String
    Dim i As Long, ts As Double

    p = InStr(1, txt, """data"":[")
    If p = 0 Then Exit Sub
    body = Mid$(txt, p + 8)
    q = InStrRev(body, "]")
    If q < 2 Then Exit Sub
    body = Trim$(Left$(body, q - 1))
    If Len(body) < 5 Then Exit Sub
    body = Replace(body, """", "")
    body = Mid$(body, 2, Len(body) - 2)       'strip outer [ ]
    rows = Split(body, "],[")

    For i = 0 To UBound(rows)
        f = Split(rows(i), ",")
        If UBound(f) >= 6 Then
            ts = Val(f(0))
            If ts > 0 Then
                'store as O,H,L,C,V,T   (Val is locale independent)
                d(ts) = Array(Val(f(1)), Val(f(3)), Val(f(4)), Val(f(2)), Val(f(5)), Val(f(6)))
            End If
        End If
    Next i
End Sub


'=====================================================================
' WRITE  (sorted, only closed candles, only ts > afterTs)
'=====================================================================
Private Function WriteCandles(ws As Worksheet, d As Object, stepSec As Long, nowTs As Double, _
                              afterTs As Double, startRow As Long) As Long
    Dim keys() As Double, k As Variant, n As Long, i As Long, m As Long
    Dim arr() As Variant, v As Variant, ts As Double

    If d.Count = 0 Then Exit Function
    ReDim keys(0 To d.Count - 1)
    For Each k In d.keys
        keys(n) = CDbl(k): n = n + 1
    Next k
    QuickSort keys, 0, n - 1

    ReDim arr(1 To n, 1 To 8)
    For i = 0 To n - 1
        ts = keys(i)
        If ts > afterTs And ts + stepSec <= nowTs Then     'closed candles only
            m = m + 1
            v = d(ts)
            arr(m, 1) = ts
            arr(m, 2) = v(0): arr(m, 3) = v(1): arr(m, 4) = v(2): arr(m, 5) = v(3)
            arr(m, 6) = v(4): arr(m, 7) = v(5)
            arr(m, 8) = DateSerial(1970, 1, 1) + ts / 86400#
        End If
    Next i
    If m = 0 Then Exit Function

    ws.Cells(startRow, 1).Resize(m, 8).Value = SliceRows(arr, m)
    ws.Range(ws.Cells(startRow, 8), ws.Cells(startRow + m - 1, 8)).NumberFormat = "yyyy-mm-dd hh:mm"
    WriteCandles = m
End Function

Private Function SliceRows(arr() As Variant, m As Long) As Variant
    Dim out() As Variant, i As Long, j As Long
    If m = UBound(arr, 1) Then SliceRows = arr: Exit Function
    ReDim out(1 To m, 1 To 8)
    For i = 1 To m
        For j = 1 To 8
            out(i, j) = arr(i, j)
        Next j
    Next i
    SliceRows = out
End Function

Private Sub WriteHeader(ws As Worksheet)
    ws.Range("A1:H1").Value = Array("Timestamp", "Open", "High", "Low", "Close", _
                                    "Volume", "Turnover", "Time(UTC)")
    ws.Range("A1:H1").Font.Bold = True
End Sub


'=====================================================================
' VALIDATION  -> writes LastCandle / Candles / Gaps to SC_Config
'=====================================================================
Private Sub ValidateRow(wsCfg As Worksheet, r As Long)
    Dim ws As Worksheet, lastRow As Long, a As Variant, i As Long
    Dim stepSec As Long, gaps As Long, bad As Long, n As Long

    Set ws = ThisWorkbook.Worksheets(Trim$(CStr(wsCfg.Cells(r, C_SHEET).Value)))
    stepSec = TfSeconds(LCase$(Trim$(CStr(wsCfg.Cells(r, C_TF).Value))))
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    n = lastRow - 1
    wsCfg.Cells(r, C_COUNT).Value = IIf(n > 0, n, 0)
    If n < 2 Then Exit Sub

    a = ws.Range("A2:E" & lastRow).Value
    For i = 1 To n
        If i < n Then
            If a(i + 1, 1) - a(i, 1) <> stepSec Then gaps = gaps + 1
        End If
        If a(i, 3) < a(i, 2) Or a(i, 3) < a(i, 5) Or a(i, 4) > a(i, 2) Or a(i, 4) > a(i, 5) Then bad = bad + 1
    Next i

    wsCfg.Cells(r, C_GAPS).Value = gaps & IIf(bad > 0, "  | OHLC err: " & bad, "")
    wsCfg.Cells(r, C_LAST).Value = Format$(DateSerial(1970, 1, 1) + a(n, 1) / 86400#, "yyyy-mm-dd hh:mm")
    Dim suffix As String, old As String
    old = CStr(wsCfg.Cells(r, C_FIRST).Value)
    If InStr(1, old, "listing start") > 0 Then suffix = "  (listing start)"
    If InStr(1, old, "complete") > 0 Then suffix = "  (complete)"
    wsCfg.Cells(r, C_FIRST).Value = Format$(DateSerial(1970, 1, 1) + a(1, 1) / 86400#, "yyyy-mm-dd hh:mm") & suffix
End Sub


'=====================================================================
' EXPORT FOR APP  ->  ScannerData.js   (window.SCANNER_DATA = {...})
'=====================================================================
Private Function ExportForApp() As String
    'core coins (with long 15m history)  -> ScannerData.js  (full history, advanced tabs)
    'all active coins                     -> ScannerScan.js  (1day all, 4hour last 1500, 15min last 960)
    If ThisWorkbook.Path = "" Then
        MsgBox "Save the workbook first (export file goes next to it).", vbExclamation
        Exit Function
    End If
    Application.StatusBar = "Scanner DB: exporting ..."
    ExportForApp = ExportFile(EXPORT_FILE, "SCANNER_DATA", True)
    ExportFile SCAN_FILE, "SCANNER_SCAN", False
    Application.StatusBar = False
End Function

Private Function IsCoreSymbol(wsCfg As Worksheet, sym As String) As Boolean
    Dim r As Long, lastRow As Long
    lastRow = wsCfg.Cells(wsCfg.Rows.Count, C_SYMBOL).End(xlUp).Row
    For r = 2 To lastRow
        If UCase$(Trim$(CStr(wsCfg.Cells(r, C_SYMBOL).Value))) = sym And LCase$(Trim$(CStr(wsCfg.Cells(r, C_TF).Value))) = "15min" _
           And UCase$(Trim$(CStr(wsCfg.Cells(r, C_ACTIVE).Value))) = "YES" And Val(wsCfg.Cells(r, C_DAYS).Value) > ROLL_DAYS Then
            IsCoreSymbol = True: Exit Function
        End If
    Next r
End Function

Private Function ExportFile(fileName As String, varName As String, coreOnly As Boolean) As String
    Dim wsCfg As Worksheet, ws As Worksheet, lastRow As Long, r As Long, sym As String, tf As String, sh As String
    Dim a As Variant, i As Long, n As Long, first As Long, maxRows As Long, syms As Object, tfs As Object, core As Object
    Dim rowsTxt() As String, k As Variant, k2 As Variant, parts() As String, np As Long, symPart As String, path As String, f As Integer

    Set wsCfg = ThisWorkbook.Worksheets(CFG_SHEET)
    Set syms = CreateObject("Scripting.Dictionary")
    Set core = CreateObject("Scripting.Dictionary")
    lastRow = wsCfg.Cells(wsCfg.Rows.Count, C_SYMBOL).End(xlUp).Row

    For r = 2 To lastRow
        If UCase$(Trim$(CStr(wsCfg.Cells(r, C_ACTIVE).Value))) = "YES" Then
            sym = UCase$(Trim$(CStr(wsCfg.Cells(r, C_SYMBOL).Value)))
            tf = LCase$(Trim$(CStr(wsCfg.Cells(r, C_TF).Value)))
            sh = Trim$(CStr(wsCfg.Cells(r, C_SHEET).Value))
            If Not core.Exists(sym) Then core(sym) = IsCoreSymbol(wsCfg, sym)
            If (Not coreOnly Or core(sym)) And SheetExists(sh) Then
                maxRows = 0
                If Not coreOnly Then
                    If tf = "4hour" Then maxRows = 1500
                    If tf = "15min" Then maxRows = 960
                End If
                Set ws = ThisWorkbook.Worksheets(sh)
                n = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row - 1
                If n >= 2 Then
                    first = 1
                    If maxRows > 0 And n > maxRows Then first = n - maxRows + 1
                    a = ws.Range("A" & (first + 1) & ":G" & (n + 1)).Value
                    ReDim rowsTxt(1 To n - first + 1)
                    For i = 1 To n - first + 1
                        rowsTxt(i) = "[" & Num(a(i, 1)) & "," & Num(a(i, 2)) & "," & Num(a(i, 3)) & "," & _
                                     Num(a(i, 4)) & "," & Num(a(i, 5)) & "," & Num(a(i, 6)) & "," & Num(a(i, 7)) & "]"
                    Next i
                    If Not syms.Exists(sym) Then syms.Add sym, CreateObject("Scripting.Dictionary")
                    Set tfs = syms(sym)
                    tfs(tf) = """" & tf & """:[" & Join(rowsTxt, ",") & "]"
                End If
            End If
        End If
    Next r
    If syms.Count = 0 Then Exit Function

    ReDim parts(1 To syms.Count)
    For Each k In syms.keys
        symPart = ""
        For Each k2 In syms(k).keys
            symPart = symPart & IIf(symPart = "", "", ",") & syms(k)(k2)
        Next k2
        np = np + 1
        parts(np) = """" & k & """:{" & symPart & "}"
    Next k

    path = ThisWorkbook.Path & Application.PathSeparator & fileName
    f = FreeFile
    Open path For Output As #f
    Print #f, "window." & varName & "={""source"":""KuCoin"",""generatedUtc"":" & Num(NowUtcTs()) & _
              ",""workbook"":""" & ThisWorkbook.Name & """,""symbols"":{" & Join(parts, ",") & "}};"
    Close #f
    If coreOnly Then wsCfg.Range(P_EXPORT).Value = path Else wsCfg.Range(P_SCAN).Value = Format$(Now, "yyyy-mm-dd hh:mm") & "  (" & syms.Count & " coins)"
    ExportFile = path
End Function

Private Function Num(v As Variant) As String
    Num = Trim$(Str$(CDbl(v)))          'Str$ always uses "." as decimal
    If Left$(Num, 1) = "." Then Num = "0" & Num
    If Left$(Num, 2) = "-." Then Num = "-0" & Mid$(Num, 2)
End Function


'=====================================================================
' AUTO MODE  (every 15 min, AUTO_DELAY_SEC after candle close)
'=====================================================================
Public Sub SC_AutoStart()
    ThisWorkbook.Worksheets(CFG_SHEET).Range(P_AUTO).Value = "ON"
    ScheduleNext
    MsgBox "Auto mode ON." & vbCrLf & "Next run: " & Format$(mNextRun, "hh:mm:ss") & vbCrLf & _
           "Keep this workbook open.", vbInformation
End Sub

Public Sub SC_AutoStop()
    On Error Resume Next
    Application.OnTime mNextRun, "SC_AutoTick", , False
    On Error GoTo 0
    With ThisWorkbook.Worksheets(CFG_SHEET)
        .Range(P_AUTO).Value = "OFF"
        .Range(P_NEXT).Value = ""
    End With
End Sub

Public Sub SC_AutoTick()
    If UCase$(ThisWorkbook.Worksheets(CFG_SHEET).Range(P_AUTO).Value) <> "ON" Then Exit Sub
    On Error Resume Next
    RunAll False, True, True
    ThisWorkbook.Save
    On Error GoTo 0
    ScheduleNext
End Sub

Private Sub ScheduleNext()
    Dim t As Date, nextQ As Long
    t = Now
    nextQ = (Minute(t) \ 15 + 1) * 15         '15-min boundary (Tehran +3:30 aligns with UTC)
    mNextRun = DateSerial(Year(t), Month(t), Day(t)) + TimeSerial(Hour(t), nextQ, AUTO_DELAY_SEC)
    Application.OnTime mNextRun, "SC_AutoTick"
    ThisWorkbook.Worksheets(CFG_SHEET).Range(P_NEXT).Value = Format$(mNextRun, "yyyy-mm-dd hh:mm:ss")
End Sub


'=====================================================================
' HELPERS
'=====================================================================
Private Function NowUtcTs() As Double
    Dim dt As Object, u As Date
    On Error GoTo Fallback
    Set dt = CreateObject("WbemScripting.SWbemDateTime")
    dt.SetVarDate Now, True
    u = dt.GetVarDate(False)
    NowUtcTs = Round((u - DateSerial(1970, 1, 1)) * 86400#, 0)
    Exit Function
Fallback:
    NowUtcTs = Round((Now - TimeSerial(3, 30, 0) - DateSerial(1970, 1, 1)) * 86400#, 0)   'Tehran
End Function

Private Sub WaitSec(s As Double)
    Dim t As Double
    t = Timer
    Do While Timer < t + s
        DoEvents
        If Timer < t Then Exit Do          'midnight wrap
    Loop
End Sub

Private Sub QuickSort(a() As Double, ByVal lo As Long, ByVal hi As Long)
    Dim i As Long, j As Long, p As Double, tmp As Double
    i = lo: j = hi: p = a((lo + hi) \ 2)
    Do While i <= j
        Do While a(i) < p: i = i + 1: Loop
        Do While a(j) > p: j = j - 1: Loop
        If i <= j Then
            tmp = a(i): a(i) = a(j): a(j) = tmp
            i = i + 1: j = j - 1
        End If
    Loop
    If lo < j Then QuickSort a, lo, j
    If i < hi Then QuickSort a, i, hi
End Sub

Private Function SheetExists(nm As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(nm)
    On Error GoTo 0
    SheetExists = Not ws Is Nothing
End Function

Private Function GetOrCreateSheet(nm As String) As Worksheet
    If Not SheetExists(nm) Then
        With ThisWorkbook
            .Worksheets.Add(After:=.Worksheets(.Worksheets.Count)).Name = nm
        End With
    End If
    Set GetOrCreateSheet = ThisWorkbook.Worksheets(nm)
End Function
