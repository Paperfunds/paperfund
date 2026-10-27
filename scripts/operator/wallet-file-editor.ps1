param([Parameter(Mandatory=$true)][string]$ApplicationProcessIdList)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'wallet-file-local.ps1')
$identity=Assert-LocalSigner
$processIds=@($ApplicationProcessIdList.Split(',') | ForEach-Object {[int]$_})
if($processIds.Count -ne 2){throw 'KEY_TWO_CURRENT_APPLICATION_PIDS_REQUIRED'}
$expected='GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'
$file=Initialize-WalletImportFile
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$nl=[Environment]::NewLine
$form=New-Object Windows.Forms.Form;$form.Text='PaperfundSigner - LOCAL private file import';$form.Size=New-Object Drawing.Size(790,530);$form.StartPosition='CenterScreen'
$label=New-Object Windows.Forms.Label;$label.SetBounds(15,12,740,95);$label.Text="Isolated identity: $($identity.Name)$nl"+"Expected public address: $expected$nl"+"Private temporary file: $file$nl"+'Paste ONLY here. No autosave/backups. Closing deletes the temporary file.'
$text=New-Object Windows.Forms.TextBox;$text.SetBounds(15,112,740,180);$text.Multiline=$true;$text.ScrollBars='Vertical';$text.MaxLength=8192;$text.ShortcutsEnabled=$true;$text.Text=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)
$validate=New-Object Windows.Forms.Button;$validate.SetBounds(15,305,200,35);$validate.Text='Validate address only'
$import=New-Object Windows.Forms.Button;$import.SetBounds(230,305,240,35);$import.Text='Save private file and import'
$clear=New-Object Windows.Forms.Button;$clear.SetBounds(485,305,200,35);$clear.Text='Clear and delete temp file'
$status=New-Object Windows.Forms.Label;$status.SetBounds(15,355,740,110);$status.Text='Ready. Financial STOP remains asserted. This tool cannot sign or broadcast.'
$action={param([bool]$diagnostic)
 try{
  $script:file=Initialize-WalletImportFile
  [IO.File]::WriteAllText($script:file,$text.Text,(New-Object Text.UTF8Encoding($false)))
  $result=& (Join-Path $PSScriptRoot 'wallet-import.ps1') -ExpectedAddress $expected -ApplicationProcessIds $processIds -KeyFile $script:file -DiagnosticOnly:$diagnostic -PassThru
  if($diagnostic){$status.Text="VALIDATED$nl"+"Derived: $($result.publicAddress)$nl"+"Expected: $expected$nl"+'No DPAPI record created. Private temporary file remains until import or close.'}
  else{$text.Clear();$status.Text="IMPORTED; TEMPORARY FILE DELETED$nl"+"Derived: $($result.publicAddress)$nl"+"Expected: $expected$nl"+'DPAPI CurrentUser storage only. Transaction authorization: NONE.'}
 }catch{
  $code=$_.Exception.Message;if($code -notmatch '^KEY_[A-Z0-9_]+$'){$code='KEY_LOCAL_IMPORT_FAILED'}
  $derived=$_.Exception.Data['DerivedAddress'];if(-not $derived){$derived='Unavailable (see error code)'}
  $status.Text="$code$nl"+"Derived: $derived$nl"+"Expected: $expected$nl"+'No new successful import. Correct the local input or clear/close to delete it.'
 }
}
$validate.Add_Click({& $action $true});$import.Add_Click({& $action $false})
$clear.Add_Click({try{$text.Clear();Remove-WalletImportFile;$status.Text='Temporary file deleted. Financial authorization: NONE.'}catch{$status.Text='KEY_TEMP_FILE_DELETE_FAILED'}})
$form.Add_FormClosing({$text.Clear();try{Remove-WalletImportFile}catch{[Windows.Forms.MessageBox]::Show('KEY_TEMP_FILE_DELETE_FAILED: remove the private temporary file locally.','PaperfundSigner') | Out-Null}})
$form.Controls.AddRange(@($label,$text,$validate,$import,$clear,$status));[void]$form.ShowDialog();$form.Dispose()
